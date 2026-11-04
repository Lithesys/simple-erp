-- Rollback for 20261022035504_order_item_activity_product_names.sql.
-- This removes link snapshots written after this migration; export those audit rows first if they must be retained.
drop index if exists public.activity_history_order_item_name_idx;
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
  with operations as materialized (
    select
      min(h.id) as id,
      h.operation_id,
      min(h.occurred_at) as occurred_at,
      h.actor_id,
      max(h.actor_name) as actor_name,
      string_agg(distinct h.feature, ' · ' order by h.feature) as feature,
      string_agg(distinct h.action, ' · ' order by h.action) as action,
      string_agg(distinct nullif(h.entity_label, ''), ' · ' order by nullif(h.entity_label, '')) as entity_label,
      jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'action', h.action,
          'entity_type', h.entity_type,
          'entity_id', h.entity_id,
          'entity_label', h.entity_label,
          'changed_fields', h.changed_fields,
          'device', h.device,
          'auth_event', h.auth_event
        ) order by h.id
      ) as details
    from public.activity_history h
    where public.user_has_permission('activity_history.read')
    group by h.operation_id, h.actor_id
  ), filtered as materialized (
    select o.*
    from operations o
    where (p_from is null or o.occurred_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_to is null or o.occurred_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_employee is null or o.actor_id = p_employee)
      and (
        p_feature is null
        or exists (
          select 1 from jsonb_array_elements(o.details) as x(detail)
          where x.detail->>'feature' = p_feature
        )
      )
      and (
        p_action is null
        or exists (
          select 1 from jsonb_array_elements(o.details) as x(detail)
          where x.detail->>'action' = p_action
        )
      )
      and (
        nullif(btrim(p_query), '') is null
        or o.actor_name ilike '%' || btrim(p_query) || '%'
        or o.feature ilike '%' || btrim(p_query) || '%'
        or o.action ilike '%' || btrim(p_query) || '%'
        or o.entity_label ilike '%' || btrim(p_query) || '%'
        or o.details::text ilike '%' || btrim(p_query) || '%'
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
        case when p_sort = 'occurred_at' and p_direction = 'desc' then f.occurred_at end desc,
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
    'rows', coalesce(jsonb_agg(
      (to_jsonb(page_rows) - 'total_count' - 'sort_order') order by sort_order
    ), '[]'::jsonb),
    'total', coalesce(max(total_count), 0)
  ) from page_rows;
$$;

revoke all on function public.get_activity_history(date, date, text, uuid, text, text, integer, integer, text, text) from public, anon;
grant execute on function public.get_activity_history(date, date, text, uuid, text, text, integer, integer, text, text) to authenticated;


alter table public.activity_history drop column if exists related_entity_id;
