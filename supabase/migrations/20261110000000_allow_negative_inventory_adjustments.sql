-- Let product stock and stock-check actual counts represent negative inventory.
alter table public.stock_check_items
  drop constraint if exists stock_check_items_actual_stock_check;

create or replace function public.update_purchase_order_impl(
  p_purchase_order_id uuid,
  p_purchased_at timestamptz,
  p_lines jsonb
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_line jsonb;
  v_product public.products;
  v_total numeric(14, 0) := 0;
  v_seen_ids uuid[] := '{}';
  v_line_id uuid;
  v_product_id uuid;
  v_quantity numeric(14, 3);
  v_unit_cost numeric(14, 2);
  v_delta record;
begin
  if auth.uid() is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền chỉnh sửa đơn nhập' using errcode = '42501';
  end if;
  if p_purchased_at is null or p_lines is null
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) = 0 then
    raise exception 'Ngày nhập và ít nhất một mặt hàng là bắt buộc';
  end if;

  select * into v_order
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found or v_order.status not in ('pending', 'received') then
    raise exception 'Không thể sửa đơn nhập đã hủy hoặc không tồn tại';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object'
      or coalesce(v_line->>'product_id', '') !~* '^[0-9a-f-]{36}$'
      or coalesce(v_line->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
      or coalesce(v_line->>'unit_cost', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or (v_line->>'id' is not null and v_line->>'id' !~* '^[0-9a-f-]{36}$') then
      raise exception 'Mặt hàng, số lượng hoặc giá nhập không hợp lệ';
    end if;
    v_line_id := nullif(v_line->>'id', '')::uuid;
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    v_unit_cost := (v_line->>'unit_cost')::numeric;
    if v_quantity <= 0 or v_quantity > 100000000 or v_unit_cost < 0 or v_unit_cost > 999999999999 then
      raise exception 'Số lượng hoặc giá nhập vượt giới hạn';
    end if;
    if v_line_id is not null then
      if v_line_id = any(v_seen_ids) then raise exception 'Dữ liệu dòng hàng bị trùng'; end if;
      if not exists (
        select 1 from public.purchase_order_items poi
        where poi.id = v_line_id and poi.purchase_order_id = p_purchase_order_id
      ) then raise exception 'Một dòng hàng không thuộc đơn nhập này'; end if;
      v_seen_ids := array_append(v_seen_ids, v_line_id);
    end if;
    select * into v_product
    from public.products p
    where p.id = v_product_id
      and (
        p.is_active
        or exists (
          select 1 from public.purchase_order_items poi
          where poi.id = v_line_id and poi.purchase_order_id = p_purchase_order_id
            and poi.product_id = v_product_id
        )
      )
    for share;
    if not found then raise exception 'Mặt hàng không còn hoạt động'; end if;
    v_total := v_total + round(v_quantity * v_unit_cost);
  end loop;

  -- Lock all affected products in a stable order before applying inventory deltas.
  perform p.id
  from public.products p
  where p.id in (
    select poi.product_id from public.purchase_order_items poi
    where poi.purchase_order_id = p_purchase_order_id and poi.product_id is not null
    union
    select (entry.value->>'product_id')::uuid from jsonb_array_elements(p_lines) as entry(value)
  )
  order by p.id
  for update;

  if v_order.status = 'received' then
    perform set_config('app.purchase_order_id', p_purchase_order_id::text, true);
    perform set_config('app.inventory_reason', 'Điều chỉnh đơn nhập', true);
    for v_delta in
      select changes.product_id, sum(changes.quantity_change) as quantity_change
      from (
        select poi.product_id, -sum(poi.quantity) as quantity_change
        from public.purchase_order_items poi
        where poi.purchase_order_id = p_purchase_order_id and poi.product_id is not null
        group by poi.product_id
        union all
        select (entry.value->>'product_id')::uuid,
          sum((entry.value->>'quantity')::numeric)
        from jsonb_array_elements(p_lines) as entry(value)
        group by (entry.value->>'product_id')::uuid
      ) as changes
      group by changes.product_id
      having sum(changes.quantity_change) <> 0
      order by changes.product_id
    loop
      update public.products p
      set stock = p.stock + v_delta.quantity_change
      where p.id = v_delta.product_id;
      if not found then
        raise exception 'Không tìm thấy mặt hàng trong đơn nhập';
      end if;
    end loop;
  end if;

  delete from public.purchase_order_items poi
  where poi.purchase_order_id = p_purchase_order_id
    and not (poi.id = any(v_seen_ids));

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'id', '')::uuid;
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    v_unit_cost := (v_line->>'unit_cost')::numeric;
    select * into v_product from public.products p where p.id = v_product_id;
    if v_line_id is null then
      insert into public.purchase_order_items(
        purchase_order_id, product_id, sku, product_name, unit, quantity, unit_cost, line_total
      ) values (
        p_purchase_order_id, v_product.id, v_product.sku, v_product.name, v_product.unit,
        v_quantity, v_unit_cost, round(v_quantity * v_unit_cost)
      );
    else
      update public.purchase_order_items
      set product_id = v_product.id, sku = v_product.sku, product_name = v_product.name,
        unit = v_product.unit, quantity = v_quantity, unit_cost = v_unit_cost,
        line_total = round(v_quantity * v_unit_cost)
      where id = v_line_id and purchase_order_id = p_purchase_order_id;
      if not found then raise exception 'Một dòng đơn nhập không hợp lệ'; end if;
    end if;
  end loop;

  update public.purchase_orders
  set purchased_at = p_purchased_at, total = v_total
  where id = p_purchase_order_id;
  return v_total;
end;
$$;

revoke all on function public.update_purchase_order_impl(uuid, timestamptz, jsonb)
  from public, anon, authenticated;
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
    if p_action = 'complete' and (v_actual is null) then raise exception 'Vui lòng nhập số lượng thực tế hợp lệ cho mọi mặt hàng'; end if;

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

revoke all on function public.save_stock_check(uuid, text, jsonb, text, uuid)
  from public, anon;
grant execute on function public.save_stock_check(uuid, text, jsonb, text, uuid)
  to authenticated;
