create sequence public.stock_check_number_seq;

create table public.stock_checks (
  id uuid primary key default gen_random_uuid(),
  stock_check_no text not null unique default (
    'KK-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' ||
    lpad(nextval('public.stock_check_number_seq')::text, 6, '0')
  ),
  status text not null default 'draft' check (status in ('draft', 'completed', 'cancelled')),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  original_adjustment_movement_id uuid unique references public.inventory_movements(id) on delete set null
);

create table public.stock_check_items (
  id uuid primary key default gen_random_uuid(),
  stock_check_id uuid not null references public.stock_checks(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  product_name text not null,
  unit text not null default '',
  stock_before numeric(14,3),
  actual_stock numeric(14,3) check (actual_stock is null or actual_stock >= 0),
  applied_delta numeric(14,3) not null default 0,
  unit_cost_snapshot numeric(14,2) check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (stock_check_id, product_id)
);

create table public.stock_check_events (
  id uuid primary key default gen_random_uuid(),
  stock_check_id uuid not null references public.stock_checks(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'updated', 'completed', 'cancelled', 'imported')),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create table public.stock_check_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  stock_check_id uuid references public.stock_checks(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.inventory_movements
  add column stock_check_id uuid references public.stock_checks(id) on delete set null;
create index stock_checks_created_idx on public.stock_checks(created_at desc, id desc);
create index stock_checks_status_idx on public.stock_checks(status, created_at desc);
create index stock_check_items_check_idx on public.stock_check_items(stock_check_id, sort_order);
create index stock_check_items_product_idx on public.stock_check_items(product_id);
create index inventory_movements_stock_check_idx on public.inventory_movements(stock_check_id);

alter table public.stock_checks enable row level security;
alter table public.stock_check_items enable row level security;
alter table public.stock_check_events enable row level security;
alter table public.stock_check_requests enable row level security;
revoke all on public.stock_checks, public.stock_check_items, public.stock_check_events,
  public.stock_check_requests from public, anon, authenticated;
grant select, insert, update, delete on public.stock_checks, public.stock_check_items,
  public.stock_check_events, public.stock_check_requests to authenticated;

update public.roles
set permissions = array(
  select distinct permission
  from unnest(permissions || array[
    'stock_checks.read', 'stock_checks.create', 'stock_checks.update',
    'stock_checks.delete', 'stock_checks.complete', 'stock_checks.export'
  ]::text[]) as permission
  order by permission
)
where is_system and name = 'Admin';

create or replace function public.record_stock_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_purchase_order_id uuid;
  v_stock_check_id uuid;
  v_reason text;
  v_unit_cost numeric(14,2);
begin
  if new.stock is distinct from old.stock then
    v_order_id := nullif(current_setting('app.checkout_order_id', true), '')::uuid;
    v_purchase_order_id := nullif(current_setting('app.purchase_order_id', true), '')::uuid;
    v_stock_check_id := nullif(current_setting('app.stock_check_id', true), '')::uuid;
    v_reason := coalesce(
      nullif(current_setting('app.inventory_reason', true), ''),
      case when v_order_id is null then 'Điều chỉnh tồn kho' else 'Bán hàng' end
    );

    if v_order_id is null and v_purchase_order_id is null and v_stock_check_id is null then
      if auth.uid() is null or not public.user_has_permission('stock_checks.create')
        or not public.user_has_permission('stock_checks.complete') then
        raise exception 'Cần quyền tạo và hoàn thành phiếu kiểm kho để điều chỉnh tồn kho' using errcode = '42501';
      end if;

      select pc.cost into v_unit_cost
      from public.product_costs pc where pc.product_id = new.id;

      insert into public.stock_checks(status, note, created_by, completed_at, completed_by)
      values ('completed', 'Tạo tự động từ thao tác điều chỉnh tồn kho', auth.uid(), now(), auth.uid())
      returning id into v_stock_check_id;

      insert into public.stock_check_items(
        stock_check_id, product_id, sku, product_name, unit,
        stock_before, actual_stock, applied_delta, unit_cost_snapshot, sort_order
      ) values (
        v_stock_check_id, new.id, new.sku, new.name, new.unit,
        old.stock, new.stock, new.stock - old.stock, v_unit_cost, 0
      );

      insert into public.stock_check_events(stock_check_id, event_type, actor_id, details)
      values (v_stock_check_id, 'completed', auth.uid(), jsonb_build_object('source', 'product_stock_update'));
      v_reason := 'Kiểm kho';
    end if;

    insert into public.inventory_movements(
      product_id, order_id, purchase_order_id, stock_check_id,
      quantity_change, stock_after, reason, actor_id
    ) values (
      new.id, v_order_id, v_purchase_order_id, v_stock_check_id,
      new.stock - old.stock, new.stock, v_reason, auth.uid()
    );
  end if;
  return new;
end $$;

create or replace function public.get_stock_check_products(p_query text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not (
    public.user_has_permission('stock_checks.read') or
    public.user_has_permission('stock_checks.create') or
    public.user_has_permission('stock_checks.update')
  ) then raise exception 'Không có quyền tìm hàng hóa để kiểm kho' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit, 'stock', p.stock,
    'unit_cost', case when public.user_has_permission('products.cost.read') then pc.cost else null end
  ) order by p.name, p.sku), '[]'::jsonb)
  into v_rows
  from (
    select * from public.products
    where is_active and kind = 'product'
      and (coalesce(trim(p_query), '') = '' or sku ilike '%' || trim(p_query) || '%' or name ilike '%' || trim(p_query) || '%')
    order by name, sku limit 100
  ) p
  left join public.product_costs pc on pc.product_id = p.id;
  return v_rows;
end $$;
revoke all on function public.get_stock_check_products(text) from public, anon;
grant execute on function public.get_stock_check_products(text) to authenticated;

create or replace function public.get_stock_checks(
  p_from date default null, p_to date default null, p_query text default '',
  p_statuses text[] default null, p_sort text default 'created_at',
  p_direction text default 'desc', p_limit integer default 1000, p_offset integer default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb; v_total bigint;
begin
  if auth.uid() is null or not (
    public.user_has_permission('stock_checks.read') or
    public.user_has_permission('stock_checks.update') or
    public.user_has_permission('stock_checks.delete') or
    public.user_has_permission('stock_checks.complete')
  ) then raise exception 'Không có quyền xem danh sách kiểm kho' using errcode = '42501'; end if;

  with filtered as (
    select sc.*, coalesce(nullif(pr.display_name, ''), '—') as actor_name,
      count(si.id)::integer as item_count, coalesce(sum(si.applied_delta), 0) as delta_total,
      case when public.user_has_permission('products.cost.read')
        then sum(si.applied_delta * si.unit_cost_snapshot) else null end as value_delta_total
    from public.stock_checks sc
    left join public.profiles pr on pr.id = sc.created_by
    left join public.stock_check_items si on si.stock_check_id = sc.id
    where (p_from is null or (sc.created_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from)
      and (p_to is null or (sc.created_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to)
      and (coalesce(trim(p_query), '') = '' or sc.stock_check_no ilike '%' || trim(p_query) || '%' or sc.note ilike '%' || trim(p_query) || '%')
      and (coalesce(cardinality(p_statuses), 0) = 0 or sc.status = any(p_statuses))
    group by sc.id, pr.display_name
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select sc.*, coalesce(nullif(pr.display_name, ''), '—') as actor_name,
      count(si.id)::integer as item_count, coalesce(sum(si.applied_delta), 0) as delta_total,
      case when public.user_has_permission('products.cost.read')
        then sum(si.applied_delta * si.unit_cost_snapshot) else null end as value_delta_total
    from public.stock_checks sc
    left join public.profiles pr on pr.id = sc.created_by
    left join public.stock_check_items si on si.stock_check_id = sc.id
    where (p_from is null or (sc.created_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from)
      and (p_to is null or (sc.created_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to)
      and (coalesce(trim(p_query), '') = '' or sc.stock_check_no ilike '%' || trim(p_query) || '%' or sc.note ilike '%' || trim(p_query) || '%')
      and (coalesce(cardinality(p_statuses), 0) = 0 or sc.status = any(p_statuses))
    group by sc.id, pr.display_name
  ), page as (
    select * from filtered
    order by
      case when p_sort = 'stock_check_no' and p_direction = 'asc' then stock_check_no end asc,
      case when p_sort = 'stock_check_no' and p_direction <> 'asc' then stock_check_no end desc,
      case when p_sort = 'status' and p_direction = 'asc' then status end asc,
      case when p_sort = 'status' and p_direction <> 'asc' then status end desc,
      case when p_sort = 'created_at' and p_direction = 'asc' then created_at end asc,
      case when p_sort <> 'stock_check_no' and p_sort <> 'status' and p_direction <> 'asc' then created_at end desc,
      id desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'stock_check_no', stock_check_no, 'status', status, 'note', note,
    'created_at', created_at, 'created_by', created_by, 'actor_name', actor_name,
    'updated_at', updated_at, 'completed_at', completed_at, 'completed_by', completed_by,
    'cancelled_at', cancelled_at, 'cancelled_by', cancelled_by,
    'item_count', item_count, 'delta_total', delta_total, 'value_delta_total', value_delta_total
  ) order by
    case when p_sort = 'stock_check_no' and p_direction = 'asc' then stock_check_no end asc,
    case when p_sort = 'stock_check_no' and p_direction <> 'asc' then stock_check_no end desc,
    case when p_sort = 'status' and p_direction = 'asc' then status end asc,
    case when p_sort = 'status' and p_direction <> 'asc' then status end desc,
    case when p_sort = 'created_at' and p_direction = 'asc' then created_at end asc,
    case when p_sort <> 'stock_check_no' and p_sort <> 'status' and p_direction <> 'asc' then created_at end desc,
    id desc), '[]'::jsonb)
  into v_rows from page;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;
revoke all on function public.get_stock_checks(date, date, text, text[], text, text, integer, integer) from public, anon;
grant execute on function public.get_stock_checks(date, date, text, text[], text, text, integer, integer) to authenticated;

create or replace function public.get_stock_check(p_stock_check_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not (
    public.user_has_permission('stock_checks.read') or public.user_has_permission('stock_checks.update') or
    public.user_has_permission('stock_checks.delete') or public.user_has_permission('stock_checks.complete')
  ) then raise exception 'Không có quyền xem phiếu kiểm kho' using errcode = '42501'; end if;

  select jsonb_build_object(
    'id', sc.id, 'stock_check_no', sc.stock_check_no, 'status', sc.status, 'note', sc.note,
    'created_at', sc.created_at, 'created_by', sc.created_by,
    'actor_name', coalesce(nullif(pr.display_name, ''), '—'), 'updated_at', sc.updated_at,
    'completed_at', sc.completed_at, 'cancelled_at', sc.cancelled_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', si.id, 'product_id', si.product_id, 'sku', si.sku, 'product_name', si.product_name,
      'unit', si.unit, 'stock_before', si.stock_before, 'actual_stock', si.actual_stock,
      'applied_delta', si.applied_delta,
      'unit_cost', case when public.user_has_permission('products.cost.read') then si.unit_cost_snapshot else null end,
      'value_delta', case when public.user_has_permission('products.cost.read') then si.applied_delta * si.unit_cost_snapshot else null end,
      'sort_order', si.sort_order
    ) order by si.sort_order, si.id) from public.stock_check_items si where si.stock_check_id = sc.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'event_type', se.event_type, 'created_at', se.created_at,
      'actor_name', coalesce(nullif(actor.display_name, ''), '—'), 'details', se.details
    ) order by se.created_at, se.id) from public.stock_check_events se
      left join public.profiles actor on actor.id = se.actor_id where se.stock_check_id = sc.id), '[]'::jsonb)
  ) into v_result
  from public.stock_checks sc left join public.profiles pr on pr.id = sc.created_by
  where sc.id = p_stock_check_id;
  if v_result is null then raise exception 'Phiếu kiểm kho không tồn tại'; end if;
  return v_result;
end $$;
revoke all on function public.get_stock_check(uuid) from public, anon;
grant execute on function public.get_stock_check(uuid) to authenticated;

create or replace function public.save_stock_check(
  p_stock_check_id uuid, p_note text, p_items jsonb, p_action text, p_request_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_stock_check_id;
  v_status text;
  v_line public.stock_check_items%rowtype;
  v_old public.stock_check_items%rowtype;
  v_product public.products%rowtype;
  v_existing_request uuid;
  v_request_rows integer;
  v_item jsonb;
  v_product_id uuid;
  v_actual numeric(14,3);
  v_before numeric(14,3);
  v_old_delta numeric(14,3);
  v_new_delta numeric(14,3);
  v_adjustment numeric(14,3);
  v_cost numeric(14,2);
  v_is_imported boolean;
  v_before_items jsonb;
  v_after_items jsonb;
  v_before_note text;
  v_position integer := 0;
  v_count integer := 0;
  v_event text;
begin
  if auth.uid() is null or p_request_id is null then raise exception 'Phiên làm việc không hợp lệ' using errcode = '42501'; end if;
  if p_action not in ('draft', 'complete') or jsonb_typeof(p_items) <> 'array' then raise exception 'Dữ liệu phiếu kiểm kho không hợp lệ'; end if;

  insert into public.stock_check_requests(request_id, actor_id, stock_check_id)
  values (p_request_id, auth.uid(), v_id)
  on conflict do nothing;
  get diagnostics v_request_rows = row_count;
  if v_request_rows = 0 then
    select stock_check_id into v_existing_request from public.stock_check_requests
    where request_id = p_request_id and actor_id = auth.uid();
    if v_existing_request is null then raise exception 'Yêu cầu trùng đang được xử lý; vui lòng tải lại phiếu'; end if;
    return v_existing_request;
  end if;

  if v_id is null then
    if not public.user_has_permission('stock_checks.create') then raise exception 'Không có quyền tạo phiếu kiểm kho' using errcode = '42501'; end if;
    if p_action = 'complete' and not public.user_has_permission('stock_checks.complete') then raise exception 'Không có quyền hoàn thành phiếu kiểm kho' using errcode = '42501'; end if;
    insert into public.stock_checks(note, created_by) values (coalesce(p_note, ''), auth.uid()) returning id into v_id;
    v_status := 'draft';
    v_event := 'created';
  else
    if not public.user_has_permission('stock_checks.update') then raise exception 'Không có quyền sửa phiếu kiểm kho' using errcode = '42501'; end if;
    select status into v_status from public.stock_checks where id = v_id for update;
    if not found then raise exception 'Phiếu kiểm kho không tồn tại'; end if;
    if v_status = 'cancelled' then raise exception 'Phiếu đã hủy không thể sửa'; end if;
    select original_adjustment_movement_id is not null into v_is_imported from public.stock_checks where id = v_id;
    select note into v_before_note from public.stock_checks where id = v_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'sku', sku, 'product_name', product_name, 'unit', unit,
      'stock_before', stock_before, 'actual_stock', actual_stock, 'applied_delta', applied_delta
    ) order by sort_order, id), '[]'::jsonb)
    into v_before_items from public.stock_check_items where stock_check_id = v_id;
    if v_status = 'completed' and p_action <> 'complete' then raise exception 'Phiếu đã hoàn thành không thể lưu tạm'; end if;
    if p_action = 'complete' and not public.user_has_permission('stock_checks.complete') then raise exception 'Không có quyền hoàn thành phiếu kiểm kho' using errcode = '42501'; end if;
    v_event := 'updated';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) a
    group by a->>'product_id' having count(*) > 1
  ) then raise exception 'Không thể thêm trùng mặt hàng trong phiếu'; end if;

  perform p.id from public.products p
  where p.id in (
    select si.product_id from public.stock_check_items si where si.stock_check_id = v_id and si.product_id is not null
    union select (a->>'product_id')::uuid from jsonb_array_elements(p_items) a where nullif(a->>'product_id', '') is not null
  ) order by p.id for update;

  for v_old in select * from public.stock_check_items where stock_check_id = v_id loop
    if not exists (select 1 from jsonb_array_elements(p_items) a where a->>'product_id' = v_old.product_id::text) then
      if v_status = 'completed' and v_old.applied_delta <> 0 and v_old.product_id is not null then
        perform set_config('app.stock_check_id', v_id::text, true);
        perform set_config('app.inventory_reason', 'Kiểm kho', true);
        update public.products set stock = stock - v_old.applied_delta where id = v_old.product_id;
      end if;
      delete from public.stock_check_items where id = v_old.id;
    end if;
  end loop;

  perform set_config('app.stock_check_id', v_id::text, true);
  perform set_config('app.inventory_reason', 'Kiểm kho', true);
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_position := v_position + 1;
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    if v_product_id is null then raise exception 'Phiếu có mặt hàng không hợp lệ'; end if;
    select * into v_product from public.products where id = v_product_id and is_active and kind = 'product';
    if not found then raise exception 'Một mặt hàng đã bị ngừng kinh doanh hoặc không tồn tại'; end if;
    if nullif(v_item->>'actual_stock', '') is null then v_actual := null;
    else v_actual := (v_item->>'actual_stock')::numeric(14,3); end if;
    if p_action = 'complete' and (v_actual is null or v_actual < 0) then raise exception 'Vui lòng nhập số lượng thực tế hợp lệ cho mọi mặt hàng'; end if;

    select * into v_line from public.stock_check_items where stock_check_id = v_id and product_id = v_product_id for update;
    if found then
      v_before := v_line.stock_before;
      v_old_delta := case when v_status = 'completed' then v_line.applied_delta else 0 end;
      if v_status = 'completed' and v_before is null then raise exception 'Phiếu cũ thiếu tồn kho làm mốc; không thể sửa số lượng'; end if;
      v_cost := v_line.unit_cost_snapshot;
    else
      v_before := v_product.stock;
      v_old_delta := 0;
      v_cost := null;
    end if;

    v_new_delta := case when p_action = 'complete' then v_actual - v_before else 0 end;
    v_adjustment := v_new_delta - v_old_delta;
    if p_action = 'complete' and v_cost is null and not coalesce(v_is_imported, false) then
      select pc.cost into v_cost from public.product_costs pc where pc.product_id = v_product_id;
    end if;
    if v_adjustment <> 0 then
      update public.products set stock = stock + v_adjustment where id = v_product_id;
      if not found then raise exception 'Không thể cập nhật tồn kho cho mặt hàng'; end if;
    end if;

    insert into public.stock_check_items(
      stock_check_id, product_id, sku, product_name, unit, stock_before,
      actual_stock, applied_delta, unit_cost_snapshot, sort_order
    ) values (
      v_id, v_product_id, v_product.sku, v_product.name, v_product.unit,
      v_before, v_actual, v_new_delta, v_cost, v_position
    ) on conflict (stock_check_id, product_id) do update set
      sku = excluded.sku, product_name = excluded.product_name, unit = excluded.unit,
      stock_before = excluded.stock_before, actual_stock = excluded.actual_stock,
      applied_delta = excluded.applied_delta, unit_cost_snapshot = excluded.unit_cost_snapshot,
      sort_order = excluded.sort_order;
    v_count := v_count + 1;
  end loop;

  if p_action = 'complete' and v_count = 0 then raise exception 'Phiếu kiểm kho phải có ít nhất một mặt hàng'; end if;
  if p_action = 'complete' then
    update public.stock_checks set status = 'completed', note = coalesce(p_note, ''), updated_at = now(),
      completed_at = coalesce(completed_at, now()), completed_by = auth.uid() where id = v_id;
    v_event := case when v_status = 'completed' then 'updated' else 'completed' end;
  else
    update public.stock_checks set note = coalesce(p_note, ''), updated_at = now() where id = v_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', product_id, 'sku', sku, 'product_name', product_name, 'unit', unit,
    'stock_before', stock_before, 'actual_stock', actual_stock, 'applied_delta', applied_delta
  ) order by sort_order, id), '[]'::jsonb)
  into v_after_items from public.stock_check_items where stock_check_id = v_id;

  insert into public.stock_check_events(stock_check_id, event_type, actor_id, details)
  values (v_id, v_event, auth.uid(), jsonb_build_object(
    'status', p_action, 'item_count', v_count, 'note_before', v_before_note,
    'note_after', coalesce(p_note, ''), 'items_before', v_before_items, 'items_after', v_after_items
  ));
  update public.stock_check_requests set stock_check_id = v_id where request_id = p_request_id;
  return v_id;
end $$;
revoke all on function public.save_stock_check(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.save_stock_check(uuid, text, jsonb, text, uuid) to authenticated;

create or replace function public.delete_stock_check(p_stock_check_id uuid, p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rows integer; v_status text; v_existing uuid;
begin
  if auth.uid() is null or p_request_id is null or not public.user_has_permission('stock_checks.delete') then
    raise exception 'Không có quyền xóa phiếu kiểm kho' using errcode = '42501';
  end if;
  insert into public.stock_check_requests(request_id, actor_id, stock_check_id)
  values (p_request_id, auth.uid(), p_stock_check_id) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select stock_check_id into v_existing from public.stock_check_requests where request_id = p_request_id and actor_id = auth.uid();
    if v_existing is not null then return; end if;
    raise exception 'Yêu cầu trùng đang được xử lý';
  end if;
  select status into v_status from public.stock_checks where id = p_stock_check_id for update;
  if v_status is distinct from 'draft' then raise exception 'Chỉ có thể xóa phiếu tạm'; end if;
  delete from public.stock_checks where id = p_stock_check_id;
end $$;
revoke all on function public.delete_stock_check(uuid, uuid) from public, anon;
grant execute on function public.delete_stock_check(uuid, uuid) to authenticated;

create or replace function public.cancel_stock_check(p_stock_check_id uuid, p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rows integer; v_status text; v_existing uuid; v_item record; v_before_items jsonb;
begin
  if auth.uid() is null or p_request_id is null or not public.user_has_permission('stock_checks.delete')
    or not public.user_has_permission('stock_checks.complete') then
    raise exception 'Cần quyền hủy và hoàn thành phiếu kiểm kho' using errcode = '42501';
  end if;
  insert into public.stock_check_requests(request_id, actor_id, stock_check_id)
  values (p_request_id, auth.uid(), p_stock_check_id) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select stock_check_id into v_existing from public.stock_check_requests where request_id = p_request_id and actor_id = auth.uid();
    if v_existing is not null then return; end if;
    raise exception 'Yêu cầu trùng đang được xử lý';
  end if;
  select status into v_status from public.stock_checks where id = p_stock_check_id for update;
  if v_status <> 'completed' then raise exception 'Chỉ có thể hủy phiếu đã hoàn thành'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', product_id, 'sku', sku, 'product_name', product_name,
    'stock_before', stock_before, 'actual_stock', actual_stock, 'applied_delta', applied_delta
  ) order by sort_order, id), '[]'::jsonb) into v_before_items
  from public.stock_check_items where stock_check_id = p_stock_check_id;
  perform p.id from public.products p
    where p.id in (select product_id from public.stock_check_items where stock_check_id = p_stock_check_id and product_id is not null)
    order by p.id for update;
  perform set_config('app.stock_check_id', p_stock_check_id::text, true);
  perform set_config('app.inventory_reason', 'Hủy kiểm kho', true);
  for v_item in select product_id, applied_delta from public.stock_check_items
    where stock_check_id = p_stock_check_id and product_id is not null and applied_delta <> 0 order by product_id
  loop
    update public.products set stock = stock - v_item.applied_delta where id = v_item.product_id;
  end loop;
  update public.stock_checks set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), updated_at = now()
    where id = p_stock_check_id;
  insert into public.stock_check_events(stock_check_id, event_type, actor_id, details)
  values (p_stock_check_id, 'cancelled', auth.uid(), jsonb_build_object('reversed_items', v_before_items));
end $$;
revoke all on function public.cancel_stock_check(uuid, uuid) from public, anon;
grant execute on function public.cancel_stock_check(uuid, uuid) to authenticated;

-- Preserve every existing manual inventory movement as its own completed document.
do $$
declare
  v_movement record;
  v_check_id uuid;
  v_stock_after numeric(14,3);
  v_product public.products%rowtype;
begin
  for v_movement in
    select m.* from public.inventory_movements m
    where m.reason = 'Điều chỉnh tồn kho' and m.stock_check_id is null
    order by m.created_at, m.id
  loop
    v_stock_after := v_movement.stock_after;
    if v_stock_after is null and v_movement.product_id is not null then
      select p.stock - coalesce(sum(later.quantity_change), 0) into v_stock_after
      from public.products p
      left join public.inventory_movements later on later.product_id = v_movement.product_id
        and (later.created_at > v_movement.created_at or (later.created_at = v_movement.created_at and later.id > v_movement.id))
      where p.id = v_movement.product_id group by p.stock;
    end if;
    insert into public.stock_checks(stock_check_no, status, note, created_at, created_by,
      completed_at, completed_by, original_adjustment_movement_id)
    values (
      'KK-' || to_char(v_movement.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' ||
      lpad(nextval('public.stock_check_number_seq')::text, 6, '0'),
      'completed', 'Tạo từ lịch sử điều chỉnh tồn kho', v_movement.created_at,
      v_movement.actor_id, v_movement.created_at, v_movement.actor_id, v_movement.id
    ) returning id into v_check_id;
    if v_movement.product_id is not null then
      select * into v_product from public.products where id = v_movement.product_id;
    end if;
    insert into public.stock_check_items(
      stock_check_id, product_id, sku, product_name, unit, stock_before,
      actual_stock, applied_delta, unit_cost_snapshot, sort_order
    ) values (
      v_check_id, v_movement.product_id, coalesce(v_product.sku, '—'),
      coalesce(v_product.name, 'Hàng hóa đã xóa'), coalesce(v_product.unit, ''),
      case when v_stock_after is null then null else v_stock_after - v_movement.quantity_change end,
      v_stock_after, v_movement.quantity_change, null, 0
    );
    update public.inventory_movements set stock_check_id = v_check_id, reason = 'Kiểm kho' where id = v_movement.id;
    insert into public.stock_check_events(stock_check_id, event_type, actor_id, created_at, details)
    values (v_check_id, 'imported', v_movement.actor_id, v_movement.created_at,
      jsonb_build_object('inventory_movement_id', v_movement.id));
  end loop;
end $$;

drop function if exists public.get_product_inventory_history(uuid);
create function public.get_product_inventory_history(p_product_id uuid)
returns table(
  id uuid, created_at timestamptz, reason text, quantity_change numeric, stock_after numeric,
  counterparty text, actor_name text, order_id uuid, purchase_order_id uuid,
  order_no text, purchase_no text, source_date date, is_cancelled boolean, stock_check_id uuid
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    public.user_has_permission('products.read') or public.user_has_permission('products.update')
  ) then raise exception 'Không có quyền xem lịch sử hàng hóa' using errcode = '42501'; end if;
  return query
  select m.id, m.created_at, m.reason, m.quantity_change,
    coalesce(m.stock_after, p.stock - coalesce((
      select sum(later.quantity_change) from public.inventory_movements later
      where later.product_id = m.product_id
        and (later.created_at > m.created_at or (later.created_at = m.created_at and later.id > m.id))
    ), 0)) as stock_after,
    coalesce(o.customer_name, po.purchase_no, sc.stock_check_no, '—') as counterparty,
    coalesce(nullif(actor.display_name, ''), '—') as actor_name,
    m.order_id, m.purchase_order_id, o.order_no, po.purchase_no,
    case when o.id is not null then (o.created_at at time zone 'Asia/Bangkok')::date
      when po.id is not null then (po.created_at at time zone 'Asia/Bangkok')::date else null end as source_date,
    (coalesce(o.status = 'cancelled', false) or coalesce(po.status = 'cancelled', false)) as is_cancelled,
    m.stock_check_id
  from public.inventory_movements m
  left join public.products p on p.id = m.product_id
  left join public.orders o on o.id = m.order_id
  left join public.purchase_orders po on po.id = m.purchase_order_id
  left join public.stock_checks sc on sc.id = m.stock_check_id
  left join public.profiles actor on actor.id = m.actor_id
  where m.product_id = p_product_id
  order by m.created_at desc, m.id desc limit 200;
end $$;
revoke all on function public.get_product_inventory_history(uuid) from public, anon;
grant execute on function public.get_product_inventory_history(uuid) to authenticated;

notify pgrst, 'reload schema';
