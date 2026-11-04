create or replace function public.update_pending_purchase_order(
  p_purchase_order_id uuid,
  p_purchased_at timestamptz,
  p_lines jsonb
)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.purchase_orders;
  v_line jsonb;
  v_product public.products;
  v_total numeric(14,0) := 0;
  v_seen uuid[] := '{}';
  v_line_id uuid;
  v_product_id uuid;
  v_quantity numeric(14,3);
  v_unit_cost numeric(14,2);
begin
  if auth.uid() is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền chỉnh sửa đơn nhập' using errcode = '42501';
  end if;
  if p_purchased_at is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Ngày nhập và ít nhất một mặt hàng là bắt buộc';
  end if;
  select * into v_order from public.purchase_orders where id = p_purchase_order_id for update;
  if not found or v_order.status <> 'pending' then raise exception 'Chỉ có thể sửa đơn nhập đang chờ duyệt'; end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'id', '')::uuid;
    v_product_id := nullif(v_line->>'product_id', '')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    v_unit_cost := (v_line->>'unit_cost')::numeric;
    if v_product_id is null or v_quantity <= 0 or v_unit_cost < 0 or jsonb_typeof(v_line) <> 'object'
      or coalesce(v_line->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
      or coalesce(v_line->>'unit_cost', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or (v_line->>'id' is not null and v_line->>'id' !~ '^[0-9a-fA-F-]{36}$') then
      raise exception 'Mặt hàng, số lượng hoặc giá nhập không hợp lệ';
    end if;
    if v_line_id is not null and v_line_id = any(v_seen) then raise exception 'Mặt hàng trong đơn bị trùng'; end if;
    if v_line_id is not null then v_seen := array_append(v_seen, v_line_id); end if;
    select * into v_product from public.products where id = v_product_id and is_active for share;
    if not found then raise exception 'Mặt hàng không còn hoạt động'; end if;
    v_total := v_total + round(v_quantity * v_unit_cost);
  end loop;
  if cardinality(v_seen) <> (select count(*)::integer from jsonb_array_elements(p_lines) as entry(value) where nullif(entry.value->>'id', '') is not null) then raise exception 'Dữ liệu dòng hàng không hợp lệ'; end if;

  delete from public.purchase_order_items poi
  where poi.purchase_order_id = p_purchase_order_id
    and (cardinality(v_seen) = 0 or not (poi.id = any(v_seen)));

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'id', '')::uuid;
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    v_unit_cost := (v_line->>'unit_cost')::numeric;
    select * into v_product from public.products where id = v_product_id;
    if v_line_id is null then
      insert into public.purchase_order_items(purchase_order_id, product_id, sku, product_name, unit, quantity, unit_cost, line_total)
      values (p_purchase_order_id, v_product.id, v_product.sku, v_product.name, v_product.unit, v_quantity, v_unit_cost, round(v_quantity * v_unit_cost));
    else
      update public.purchase_order_items set product_id = v_product.id, sku = v_product.sku, product_name = v_product.name,
        unit = v_product.unit, quantity = v_quantity, unit_cost = v_unit_cost, line_total = round(v_quantity * v_unit_cost)
      where id = v_line_id and purchase_order_id = p_purchase_order_id;
      if not found then raise exception 'Một dòng đơn nhập không hợp lệ'; end if;
    end if;
  end loop;
  update public.purchase_orders set purchased_at = p_purchased_at, total = v_total where id = p_purchase_order_id;
  return v_total;
end $$;
revoke all on function public.update_pending_purchase_order(uuid,timestamptz,jsonb) from public, anon;
grant execute on function public.update_pending_purchase_order(uuid,timestamptz,jsonb) to authenticated;

create or replace function public.delete_pending_purchase_order(p_purchase_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if auth.uid() is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền xóa đơn nhập' using errcode = '42501';
  end if;
  select status into v_status from public.purchase_orders where id = p_purchase_order_id for update;
  if not found or v_status <> 'pending' then raise exception 'Chỉ có thể xóa đơn nhập đang chờ duyệt'; end if;
  delete from public.purchase_orders where id = p_purchase_order_id and status = 'pending';
end $$;
revoke all on function public.delete_pending_purchase_order(uuid) from public, anon;
grant execute on function public.delete_pending_purchase_order(uuid) to authenticated;
