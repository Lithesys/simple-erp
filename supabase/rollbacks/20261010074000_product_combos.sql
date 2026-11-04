-- This script archives Combo definitions and order component snapshots first.
-- The archive schema is not exposed through the Data API. Keep it until any
-- archived Combo data has been restored or explicitly retired.
create schema if not exists rollback_archive;
revoke all on schema rollback_archive from public, anon, authenticated;
create table if not exists rollback_archive.product_combos_20261010074000 as
  select id, kind, is_active from public.products where kind = 'combo';
create table if not exists rollback_archive.product_bundle_items_20261010074000 as
  select * from public.product_bundle_items;
create table if not exists rollback_archive.order_item_components_20261010074000 as
  select * from public.order_item_components;

-- Keep old clients from selling virtual products after their recipes are removed.
update public.products set is_active = false where kind = 'combo';

drop trigger if exists prevent_combo_purchase_item_before_product_update on public.purchase_order_items;
drop trigger if exists prevent_combo_purchase_item_before_insert on public.purchase_order_items;
drop function if exists public.prevent_combo_purchase_item();
drop trigger if exists prevent_combo_stock_change_before_update on public.products;
drop function if exists public.prevent_combo_stock_change();
drop trigger if exists prevent_product_kind_change_before_update on public.products;
drop function if exists public.prevent_product_kind_change();
drop trigger if exists validate_product_bundle_item_before_write on public.product_bundle_items;
drop function if exists public.validate_product_bundle_item();
drop function if exists public.save_product_combo_items(uuid, jsonb);
drop function if exists public.create_product_combo(text, text, jsonb, jsonb);
drop policy if exists order_item_components_read on public.order_item_components;
drop policy if exists product_bundle_items_read on public.product_bundle_items;
drop table public.order_item_components;
drop table public.product_bundle_items;
alter table public.products drop column kind;

create or replace function public.checkout_order(
  p_idempotency_key uuid,
  p_price_list_id uuid,
  p_customer_name text,
  p_discount numeric,
  p_lines jsonb,
  p_customer_phone text default '',
  p_customer_address text default ''
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_existing public.orders;
  v_order public.orders;
  v_list public.price_lists;
  v_line jsonb;
  v_product public.products;
  v_price numeric(14, 2);
  v_requested_price numeric(14, 2);
  v_quantity numeric(14, 3);
  v_subtotal numeric(14, 0) := 0;
  v_discount numeric(14, 0);
  v_total numeric(14, 0);
  v_items jsonb := '[]'::jsonb;
  v_name text;
  v_can_override_price boolean := public.user_has_permission('sales.price.override');
begin
  if v_user is null or not public.user_has_permission('sales.create') then
    raise exception 'Không có quyền bán hàng' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Thiếu mã giao dịch'; end if;
  select * into v_existing
  from public.orders
  where cashier_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'total', v_existing.total);
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Đơn hàng chưa có sản phẩm';
  end if;
  select * into v_list from public.price_lists where id = p_price_list_id and is_active;
  if not found then raise exception 'Bảng giá không còn hoạt động'; end if;
  v_name := nullif(trim(coalesce(p_customer_name, '')), '');
  if v_name is null then v_name := 'Khách lẻ'; end if;
  if length(v_name) > 300
    or length(coalesce(p_customer_phone, '')) > 100
    or length(coalesce(p_customer_address, '')) > 1000
  then
    raise exception 'Thông tin khách hàng quá dài';
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines) order by value ->> 'product_id'
  loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    if v_quantity <= 0 or v_quantity > 100000000 then raise exception 'Số lượng không hợp lệ'; end if;
    select * into v_product
    from public.products
    where id = (v_line ->> 'product_id')::uuid and is_active
    for update;
    if not found then raise exception 'Sản phẩm không còn hoạt động'; end if;
    select price into v_price
    from public.product_prices
    where product_id = v_product.id and price_list_id = v_list.id
    for share;
    if not found then raise exception 'Sản phẩm chưa có giá trong bảng giá'; end if;
    if v_line ? 'expected_price' and (v_line ->> 'expected_price')::numeric <> v_price then
      raise exception 'Giá của sản phẩm "%" đã thay đổi', v_product.name using errcode = 'P0001';
    end if;
    if v_line ? 'unit_price' then
      v_requested_price := (v_line ->> 'unit_price')::numeric;
      if v_requested_price is null
        or v_requested_price::text = 'NaN'
        or v_requested_price < 0
      then
        raise exception 'Đơn giá không hợp lệ';
      end if;
      if v_requested_price is distinct from v_price then
        if not v_can_override_price then
          raise exception 'Không có quyền chỉnh sửa đơn giá' using errcode = '42501';
        end if;
        v_price := v_requested_price;
      end if;
    end if;
    v_subtotal := v_subtotal + round(v_price * v_quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id, 'sku', v_product.sku, 'product_name', v_product.name,
      'unit', v_product.unit, 'quantity', v_quantity, 'unit_price', v_price,
      'line_total', round(v_price * v_quantity)
    ));
  end loop;
  v_discount := coalesce(round(p_discount), 0);
  if v_discount < 0 or v_discount > v_subtotal then raise exception 'Mức giảm giá không hợp lệ'; end if;
  v_total := v_subtotal - v_discount;

  insert into public.orders(
    idempotency_key, cashier_id, price_list_id, price_list_name, customer_name,
    customer_phone, customer_address, subtotal, discount, total
  )
  values (
    p_idempotency_key, v_user, v_list.id, v_list.name, v_name,
    trim(coalesce(p_customer_phone, '')), trim(coalesce(p_customer_address, '')),
    v_subtotal, v_discount, v_total
  )
  on conflict (cashier_id, idempotency_key) do nothing
  returning * into v_order;
  if v_order.id is null then
    select * into v_existing
    from public.orders
    where cashier_id = v_user and idempotency_key = p_idempotency_key;
    return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'total', v_existing.total);
  end if;

  perform set_config('app.checkout_order_id', v_order.id::text, true);
  perform set_config('app.inventory_reason', 'Bán hàng', true);
  for v_line in select value from jsonb_array_elements(v_items) loop
    insert into public.order_items(
      order_id, product_id, sku, product_name, unit, quantity, unit_price, line_total
    )
    values (
      v_order.id, (v_line ->> 'product_id')::uuid, v_line ->> 'sku', v_line ->> 'product_name',
      v_line ->> 'unit', (v_line ->> 'quantity')::numeric, (v_line ->> 'unit_price')::numeric,
      (v_line ->> 'line_total')::numeric
    );
    update public.products
    set stock = stock - (v_line ->> 'quantity')::numeric
    where id = (v_line ->> 'product_id')::uuid;
  end loop;
  return jsonb_build_object('order_id', v_order.id, 'order_no', v_order.order_no, 'total', v_order.total);
end;
$$;
revoke all on function public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text) from public, anon;
grant execute on function public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text) to authenticated;

create or replace function public.edit_order(
  p_order_id uuid,
  p_lines jsonb,
  p_discount numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_item record;
  v_line jsonb;
  v_subtotal numeric(14,0);
  v_total numeric(14,0);
  v_count integer;
begin
  if auth.uid() is null or not public.user_has_permission('orders.edit') then
    raise exception 'Không có quyền chỉnh sửa đơn hàng' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Đơn hàng cần ít nhất một sản phẩm';
  end if;
  if p_discount is null or p_discount < 0 then raise exception 'Giảm giá không hợp lệ'; end if;
  if coalesce(trim(p_customer_name), '') = '' or length(p_customer_name) > 300
     or length(coalesce(p_customer_phone, '')) > 100 or length(coalesce(p_customer_address, '')) > 1000 then
    raise exception 'Thông tin khách hàng không hợp lệ';
  end if;

  select * into v_order from public.orders where id = p_order_id and status = 'completed' for update;
  if not found then raise exception 'Không tìm thấy đơn hàng'; end if;
  if exists (
    select 1 from public.order_items oi
    join rollback_archive.product_combos_20261010074000 archived_combo
      on archived_combo.id = oi.product_id
    where oi.order_id = p_order_id
  ) then
    raise exception 'Không thể chỉnh sửa đơn hàng có combo sau khi rollback; khôi phục dữ liệu combo trước';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where coalesce(line.value->>'id', '') = '' or coalesce(line.value->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
  ) then raise exception 'Số lượng sản phẩm không hợp lệ'; end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
     (select count(distinct line.value->>'id') from jsonb_array_elements(p_lines) as line(value)) then
    raise exception 'Dữ liệu sản phẩm bị trùng';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    left join public.order_items oi on oi.id = (line.value->>'id')::uuid and oi.order_id = p_order_id
    where oi.id is null
  ) then raise exception 'Đơn hàng có sản phẩm không hợp lệ'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    join public.order_items oi on oi.id = (line.value->>'id')::uuid
    where (line.value->>'quantity')::numeric > 0 and oi.product_id is null
  ) then raise exception 'Sản phẩm đã bị xóa khỏi danh mục'; end if;

  perform 1 from public.products p
  where p.id in (select distinct oi.product_id from public.order_items oi where oi.order_id = p_order_id and oi.product_id is not null)
  order by p.id for update;

  if exists (
    select 1 from public.order_items oi
    join public.products p on p.id = oi.product_id
    left join jsonb_array_elements(p_lines) as line(value) on (line.value->>'id')::uuid = oi.id
    where oi.order_id = p_order_id and (coalesce((line.value->>'quantity')::numeric, 0) > oi.quantity)
      and p.stock < (coalesce((line.value->>'quantity')::numeric, oi.quantity) - oi.quantity)
  ) then raise exception 'Tồn kho không đủ để tăng số lượng đơn hàng'; end if;

  perform set_config('app.checkout_order_id', p_order_id::text, true);
  perform set_config('app.inventory_reason', 'Điều chỉnh đơn hàng', true);
  for v_item in
    select oi.product_id, sum(oi.quantity - coalesce((line.value->>'quantity')::numeric, 0)) as stock_delta
    from public.order_items oi
    left join jsonb_array_elements(p_lines) as line(value) on (line.value->>'id')::uuid = oi.id
    where oi.order_id = p_order_id and oi.product_id is not null
    group by oi.product_id order by oi.product_id
  loop
    update public.products set stock = stock + v_item.stock_delta where id = v_item.product_id;
  end loop;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if (v_line->>'quantity')::numeric = 0 then
      delete from public.order_items where id = (v_line->>'id')::uuid and order_id = p_order_id;
    else
      update public.order_items
      set quantity = (v_line->>'quantity')::numeric,
          line_total = round(unit_price * (v_line->>'quantity')::numeric)
      where id = (v_line->>'id')::uuid and order_id = p_order_id;
    end if;
  end loop;

  select coalesce(sum(line_total), 0), count(*) into v_subtotal, v_count
  from public.order_items where order_id = p_order_id;
  if v_count = 0 then raise exception 'Đơn hàng cần có ít nhất một sản phẩm'; end if;
  if p_discount < 0 or p_discount > v_subtotal then raise exception 'Giảm giá vượt quá tổng tiền hàng'; end if;
  v_total := v_subtotal - p_discount;
  update public.orders set customer_name = trim(p_customer_name), customer_phone = coalesce(p_customer_phone, ''),
    customer_address = coalesce(p_customer_address, ''), subtotal = v_subtotal, discount = p_discount, total = v_total
  where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'subtotal', v_subtotal, 'discount', p_discount, 'total', v_total);
end $$;
revoke all on function public.edit_order(uuid, jsonb, numeric, text, text, text) from public, anon;
grant execute on function public.edit_order(uuid, jsonb, numeric, text, text, text) to authenticated;

create or replace function public.delete_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item record;
begin
  if auth.uid() is null or not public.user_has_permission('orders.delete') then
    raise exception 'Không có quyền xóa đơn hàng' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = p_order_id and status = 'completed' for update;
  if not found then raise exception 'Không tìm thấy đơn hàng hoặc đơn đã được xử lý'; end if;
  if exists (
    select 1 from public.order_items oi
    join rollback_archive.product_combos_20261010074000 archived_combo
      on archived_combo.id = oi.product_id
    where oi.order_id = p_order_id
  ) then
    raise exception 'Không thể xóa đơn hàng có combo sau khi rollback; khôi phục dữ liệu combo trước';
  end if;

  perform 1
  from public.products p
  where p.id in (
    select distinct oi.product_id
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
  )
  order by p.id
  for update;

  perform set_config('app.checkout_order_id', p_order_id::text, true);
  perform set_config('app.inventory_reason', 'Hoàn kho do xóa đơn hàng', true);
  for v_item in
    select oi.product_id, sum(oi.quantity) as quantity
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
    group by oi.product_id
    order by oi.product_id
  loop
    update public.products
    set stock = stock + v_item.quantity
    where id = v_item.product_id;
  end loop;

  delete from public.orders where id = p_order_id;
end $$;
revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated;

create or replace function public.snapshot_order_item_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_unit_cost numeric(14,2);
begin
  if tg_op = 'INSERT' then
    select coalesce(pc.cost, 0) into v_unit_cost
    from public.order_items oi left join public.product_costs pc on pc.product_id = oi.product_id
    where oi.id = new.id;
    insert into public.order_item_cost_snapshots(order_item_id, unit_cost)
    values (new.id, coalesce(v_unit_cost, 0)) on conflict (order_item_id) do nothing;
    perform public.refresh_order_profit_snapshot(new.order_id);
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.refresh_order_profit_snapshot(new.order_id);
    return new;
  else
    perform public.refresh_order_profit_snapshot(old.order_id);
    return old;
  end if;
end;
$$;
revoke all on function public.snapshot_order_item_cost() from public, anon, authenticated;
