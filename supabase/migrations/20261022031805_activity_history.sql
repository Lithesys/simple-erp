create table public.activity_history (
  id bigint generated always as identity primary key,
  operation_id text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  feature text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  entity_label text not null default '',
  changed_fields jsonb not null default '{}'::jsonb,
  device text,
  session_id uuid,
  auth_event text check (auth_event is null or auth_event in ('login', 'logout'))
);

create index activity_history_occurred_idx
  on public.activity_history (occurred_at desc, id desc);
create index activity_history_operation_idx
  on public.activity_history (operation_id, id);
create index activity_history_actor_idx
  on public.activity_history (actor_id, occurred_at desc, id desc);
create unique index activity_history_auth_session_event_idx
  on public.activity_history (session_id, auth_event)
  where session_id is not null and auth_event is not null;

alter table public.activity_history enable row level security;
revoke all on public.activity_history from public, anon, authenticated;
revoke all on public.activity_history from service_role;
grant select on public.activity_history to authenticated;
grant insert on public.activity_history to service_role;
grant usage, select on sequence public.activity_history_id_seq to service_role;

create policy activity_history_read on public.activity_history
  for select to authenticated
  using (public.user_has_permission('activity_history.read'));

create or replace function public.prevent_activity_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Lịch sử thao tác chỉ được thêm mới' using errcode = '55000';
end;
$$;
revoke all on function public.prevent_activity_history_mutation() from public, anon, authenticated;
create trigger activity_history_immutable
  before update or delete on public.activity_history
  for each row execute function public.prevent_activity_history_mutation();

create or replace function public.log_activity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_changed jsonb;
  v_id text;
  v_label text;
  v_actor_name text;
  v_action text;
  v_product_id uuid;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Stock is audited from inventory_movements so a sale, purchase, or stock
  -- check creates one inventory record rather than a duplicate product update.
  if tg_table_name = 'products' then
    v_old := v_old - 'stock' - 'created_at' - 'updated_at';
    v_new := v_new - 'stock' - 'created_at' - 'updated_at';
  else
    v_old := v_old - 'created_at' - 'updated_at';
    v_new := v_new - 'created_at' - 'updated_at';
  end if;

  select coalesce(jsonb_object_agg(changed.key, jsonb_build_object(
    'before', changed.old_value,
    'after', changed.new_value
  )), '{}'::jsonb)
  into v_changed
  from (
    select coalesce(n.key, o.key) as key, o.value as old_value, n.value as new_value
    from jsonb_each(v_old) o
    full join jsonb_each(v_new) n using (key)
    where o.value is distinct from n.value
      and coalesce(n.key, o.key) not in (
        'id', 'product_id', 'bundle_product_id', 'order_id', 'purchase_order_id',
        'stock_check_id', 'customer_id', 'price_list_id', 'cashier_id', 'created_by',
        'received_by', 'cancelled_by', 'idempotency_key'
      )
  ) changed;

  if v_changed = '{}'::jsonb then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_id := coalesce(
    v_new->>'id', v_old->>'id', v_new->>'bundle_product_id',
    v_old->>'bundle_product_id', v_new->>'product_id', v_old->>'product_id'
  );
  v_product_id := coalesce(
    case when tg_table_name = 'product_bundle_items' then
      coalesce(nullif(v_new->>'bundle_product_id', '')::uuid, nullif(v_old->>'bundle_product_id', '')::uuid)
    end,
    nullif(v_new->>'product_id', '')::uuid,
    nullif(v_old->>'product_id', '')::uuid,
    case when tg_table_name = 'products' then nullif(v_id, '')::uuid end
  );
  v_label := coalesce(
    nullif(v_new->>'order_no', ''), nullif(v_old->>'order_no', ''),
    nullif(v_new->>'purchase_no', ''), nullif(v_old->>'purchase_no', ''),
    nullif(v_new->>'sku', ''), nullif(v_old->>'sku', ''),
    nullif(v_new->>'product_name', ''), nullif(v_old->>'product_name', ''),
    nullif(v_new->>'name', ''), nullif(v_old->>'name', ''),
    nullif(v_new->>'debt_item', ''), nullif(v_old->>'debt_item', ''),
    v_id, ''
  );
  if v_product_id is not null and tg_table_name <> 'products' then
    select coalesce(nullif(p.sku, ''), p.name) into v_label
    from public.products p where p.id = v_product_id;
    v_label := coalesce(v_label, '');
  end if;

  v_action := case tg_op
    when 'INSERT' then 'Tạo'
    when 'DELETE' then 'Xóa'
    else 'Cập nhật'
  end;
  if tg_table_name in ('orders', 'purchase_orders') and tg_op = 'UPDATE' then
    if v_old->>'status' is distinct from v_new->>'status' and v_new->>'status' = 'cancelled' then
      v_action := 'Hủy';
    elsif tg_table_name = 'purchase_orders'
      and v_old->>'status' is distinct from v_new->>'status'
      and v_new->>'status' = 'received' then
      v_action := 'Hoàn thành';
    end if;
  end if;
  if tg_table_name = 'products' and tg_op = 'UPDATE'
    and v_old->>'is_active' = 'true' and v_new->>'is_active' = 'false' then
    v_action := 'Ngừng kinh doanh';
  end if;

  select coalesce(nullif(p.display_name, ''), p.username, 'Tài khoản')
  into v_actor_name from public.profiles p where p.id = auth.uid();
  insert into public.activity_history (
    operation_id, actor_id, actor_name, feature, action,
    entity_type, entity_id, entity_label, changed_fields
  ) values (
    pg_current_xact_id()::text, auth.uid(), coalesce(v_actor_name, 'Tài khoản'),
    tg_argv[0], v_action, tg_argv[1], coalesce(v_id, ''), v_label, v_changed
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.log_activity_change() from public, anon, authenticated;

create trigger activity_products after insert or update or delete on public.products
  for each row execute function public.log_activity_change('Hàng hóa', 'products');
create trigger activity_product_prices after insert or update or delete on public.product_prices
  for each row execute function public.log_activity_change('Hàng hóa', 'product_prices');
create trigger activity_product_costs after insert or update or delete on public.product_costs
  for each row execute function public.log_activity_change('Hàng hóa', 'product_costs');
create trigger activity_product_bundle_items after insert or update or delete on public.product_bundle_items
  for each row execute function public.log_activity_change('Hàng hóa', 'product_bundle_items');
create trigger activity_orders after insert or update or delete on public.orders
  for each row execute function public.log_activity_change('Đơn hàng', 'orders');
create trigger activity_order_items after insert or update or delete on public.order_items
  for each row execute function public.log_activity_change('Đơn hàng', 'order_items');
create trigger activity_purchase_orders after insert or update or delete on public.purchase_orders
  for each row execute function public.log_activity_change('Nhập hàng', 'purchase_orders');
create trigger activity_purchase_order_items after insert or update or delete on public.purchase_order_items
  for each row execute function public.log_activity_change('Nhập hàng', 'purchase_order_items');
create trigger activity_debts after insert or update or delete on public.debts
  for each row execute function public.log_activity_change('Công nợ', 'debts');

create or replace function public.log_inventory_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
  v_product record;
begin
  if new.order_id is not null or new.purchase_order_id is not null or auth.uid() is null then
    return new;
  end if;
  select p.sku, p.name into v_product from public.products p where p.id = new.product_id;
  select coalesce(nullif(p.display_name, ''), p.username, 'Tài khoản')
    into v_actor_name from public.profiles p where p.id = auth.uid();
  insert into public.activity_history (
    operation_id, actor_id, actor_name, feature, action,
    entity_type, entity_id, entity_label, changed_fields
  ) values (
    pg_current_xact_id()::text, auth.uid(), coalesce(v_actor_name, 'Tài khoản'),
    'Hàng hóa', 'Điều chỉnh tồn kho', 'inventory_movements', new.product_id::text,
    concat_ws(' · ', v_product.sku, v_product.name),
    jsonb_build_object('stock', jsonb_build_object(
      'before', new.stock_after - new.quantity_change,
      'after', new.stock_after
    ), 'quantity_change', jsonb_build_object('before', 0, 'after', new.quantity_change),
    'reason', jsonb_build_object('before', null, 'after', new.reason))
  );
  return new;
end;
$$;
revoke all on function public.log_inventory_adjustment() from public, anon, authenticated;
create trigger activity_inventory_adjustment after insert on public.inventory_movements
  for each row execute function public.log_inventory_adjustment();

create or replace function public.get_activity_history(
  p_from date default null,
  p_to date default null,
  p_query text default '',
  p_employee uuid default null,
  p_feature text default null,
  p_action text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'occurred_at',
  p_direction text default 'desc'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as materialized (
    select h.*
    from public.activity_history h
    where public.user_has_permission('activity_history.read')
      and (p_from is null or h.occurred_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_to is null or h.occurred_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_employee is null or h.actor_id = p_employee)
      and (p_feature is null or h.feature = p_feature)
      and (p_action is null or h.action = p_action)
      and (
        nullif(btrim(p_query), '') is null
        or h.actor_name ilike '%' || btrim(p_query) || '%'
        or h.feature ilike '%' || btrim(p_query) || '%'
        or h.action ilike '%' || btrim(p_query) || '%'
        or h.entity_label ilike '%' || btrim(p_query) || '%'
        or h.changed_fields::text ilike '%' || btrim(p_query) || '%'
      )
  ), ranked as (
    select f.*, count(*) over () as total_count,
      row_number() over (order by
      case when p_sort = 'actor_name' and p_direction = 'asc' then f.actor_name end asc,
      case when p_sort = 'actor_name' and p_direction = 'desc' then f.actor_name end desc,
      case when p_sort = 'feature' and p_direction = 'asc' then f.feature end asc,
      case when p_sort = 'feature' and p_direction = 'desc' then f.feature end desc,
      case when p_sort = 'details' and p_direction = 'asc' then f.entity_label end asc,
      case when p_sort = 'details' and p_direction = 'desc' then f.entity_label end desc,
      case when p_sort = 'occurred_at' and p_direction = 'asc' then f.occurred_at end asc,
      f.occurred_at desc, f.id desc
    ) as sort_order
    from filtered f
  ), page_rows as (
    select * from ranked
    order by sort_order
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(to_jsonb(page_rows) - 'total_count' - 'sort_order' order by sort_order), '[]'::jsonb),
    'total', coalesce(max(total_count), 0)
  ) from page_rows;
$$;
revoke all on function public.get_activity_history(date, date, text, uuid, text, text, integer, integer, text, text) from public, anon;
grant execute on function public.get_activity_history(date, date, text, uuid, text, text, integer, integer, text, text) to authenticated;

create or replace function public.get_activity_history_employees()
returns table(actor_id uuid, actor_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct h.actor_id, h.actor_name
  from public.activity_history h
  where public.user_has_permission('activity_history.read')
  order by h.actor_name, h.actor_id;
$$;
revoke all on function public.get_activity_history_employees() from public, anon;
grant execute on function public.get_activity_history_employees() to authenticated;

update public.roles r
set permissions = array(select distinct permission from unnest(r.permissions || array['activity_history.read']::text[]) as permission order by permission)
where r.is_system and r.name = 'Admin';
