-- Allow the system Admin role to override POS unit prices. Other roles can be
-- granted this permission explicitly from role management.
update public.roles as r
set permissions = array(
  select distinct p.permission
  from unnest(
    coalesce(r.permissions, array[]::text[]) || array['sales.price.override']::text[]
  ) as p(permission)
  order by p.permission
)
where r.is_system
  and r.name = 'Admin'
  and not ('sales.price.override' = any(coalesce(r.permissions, array[]::text[])));

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
end $$;

revoke all on function public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text) from public, anon;
grant execute on function public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text) to authenticated;
