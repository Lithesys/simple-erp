alter table public.purchase_orders
  drop constraint if exists purchase_orders_status_check,
  add constraint purchase_orders_status_check check (status in ('pending', 'received', 'cancelled')),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id) on delete set null;

create or replace function public.update_purchase_order(
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
      where p.id = v_delta.product_id
        and p.stock + v_delta.quantity_change >= 0;
      if not found then
        raise exception 'Không thể giảm tồn kho dưới 0 khi sửa đơn đã nhập';
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
revoke all on function public.update_purchase_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_purchase_order(uuid, timestamptz, jsonb) to authenticated;

create or replace function public.delete_purchase_order(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_item record;
begin
  if auth.uid() is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền xóa đơn nhập' using errcode = '42501';
  end if;
  select * into v_order
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found or v_order.status not in ('pending', 'received') then
    raise exception 'Đơn nhập đã hủy hoặc không tồn tại';
  end if;

  if v_order.status = 'received' then
    perform p.id
    from public.products p
    where p.id in (
      select poi.product_id from public.purchase_order_items poi
      where poi.purchase_order_id = p_purchase_order_id and poi.product_id is not null
    )
    order by p.id
    for update;
    perform set_config('app.purchase_order_id', p_purchase_order_id::text, true);
    perform set_config('app.inventory_reason', 'Hủy đơn nhập', true);
    for v_item in
      select poi.product_id, sum(poi.quantity) as quantity
      from public.purchase_order_items poi
      where poi.purchase_order_id = p_purchase_order_id and poi.product_id is not null
      group by poi.product_id
      order by poi.product_id
    loop
      update public.products p
      set stock = p.stock - v_item.quantity
      where p.id = v_item.product_id and p.stock >= v_item.quantity;
      if not found then
        raise exception 'Không thể xóa đơn đã nhập: tồn kho hiện tại không đủ để trừ số lượng của đơn';
      end if;
    end loop;
  end if;

  -- Keep the order and its line snapshots for audit; cancelled orders are hidden by default in the UI.
  update public.purchase_orders
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_purchase_order_id;
end;
$$;
revoke all on function public.delete_purchase_order(uuid) from public, anon;
grant execute on function public.delete_purchase_order(uuid) to authenticated;
