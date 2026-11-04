create or replace function public.edit_order(
  p_order_id uuid,
  p_lines jsonb,
  p_discount numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_item record;
  v_line jsonb;
  v_subtotal numeric(14, 0);
  v_total numeric(14, 0);
  v_count integer;
begin
  if auth.uid() is null or not public.user_has_permission('orders.edit') then
    raise exception 'Không có quyền chỉnh sửa đơn hàng' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Danh sách sản phẩm không hợp lệ';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Đơn hàng cần có ít nhất một sản phẩm';
  end if;
  if p_discount is null or p_discount < 0 then
    raise exception 'Giảm giá không hợp lệ';
  end if;
  if coalesce(trim(p_customer_name), '') = '' or length(p_customer_name) > 300
    or length(coalesce(p_customer_phone, '')) > 100
    or length(coalesce(p_customer_address, '')) > 1000 then
    raise exception 'Thông tin khách hàng không hợp lệ';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and status = 'completed'
  for update;
  if not found then raise exception 'Không tìm thấy đơn hàng'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    where jsonb_typeof(line.value) <> 'object'
      or coalesce(line.value->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(line.value->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
      or (
        line.value ? 'unit_price'
        and coalesce(line.value->>'unit_price', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
      )
  ) then
    raise exception 'Số lượng hoặc đơn giá sản phẩm không hợp lệ';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    where line.value ? 'unit_price'
      and (line.value->>'unit_price')::numeric > 999999999999.99
  ) then
    raise exception 'Đơn giá sản phẩm vượt quá giới hạn';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
    (select count(distinct (line.value->>'id')::uuid)
     from jsonb_array_elements(p_lines) as line(value)) then
    raise exception 'Dữ liệu sản phẩm bị trùng';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
    (select count(*) from public.order_items where order_id = p_order_id) then
    raise exception 'Danh sách sản phẩm trong đơn hàng không đầy đủ';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    left join public.order_items oi
      on oi.id = (line.value->>'id')::uuid and oi.order_id = p_order_id
    where oi.id is null
  ) then
    raise exception 'Đơn hàng có sản phẩm không hợp lệ';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    join public.order_items oi on oi.id = (line.value->>'id')::uuid
    where (line.value->>'quantity')::numeric > 0 and oi.product_id is null
  ) then
    raise exception 'Sản phẩm đã bị xóa khỏi danh mục';
  end if;

  -- Lock inventory rows in a stable order so edits serialize with sales and stock changes.
  perform p.id
  from public.products p
  where p.id in (
    select oi.product_id
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
    union
    select component.product_id
    from public.order_item_components component
    join public.order_items oi on oi.id = component.order_item_id
    where oi.order_id = p_order_id and component.product_id is not null
  )
  order by p.id
  for update;

  perform set_config('app.checkout_order_id', p_order_id::text, true);
  perform set_config('app.inventory_reason', 'Điều chỉnh đơn hàng', true);
  for v_item in
    with requested as (
      select
        (line.value->>'id')::uuid as order_item_id,
        (line.value->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_lines) as line(value)
    ),
    stock_delta as (
      select oi.product_id, oi.quantity - requested.quantity as quantity
      from public.order_items oi
      join public.products product
        on product.id = oi.product_id and product.kind = 'product'
      join requested on requested.order_item_id = oi.id
      where oi.order_id = p_order_id
      union all
      select
        component.product_id,
        component.quantity_per_bundle * (oi.quantity - requested.quantity) as quantity
      from public.order_items oi
      join public.products combo on combo.id = oi.product_id and combo.kind = 'combo'
      join public.order_item_components component on component.order_item_id = oi.id
      join requested on requested.order_item_id = oi.id
      where oi.order_id = p_order_id and component.product_id is not null
    )
    select product_id, round(sum(quantity), 3) as quantity
    from stock_delta
    group by product_id
    order by product_id
  loop
    -- Negative inventory is allowed for order edits, just as it is for checkout.
    update public.products
    set stock = stock + v_item.quantity
    where id = v_item.product_id;
  end loop;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if (v_line->>'quantity')::numeric = 0 then
      delete from public.order_items
      where id = (v_line->>'id')::uuid and order_id = p_order_id;
    else
      update public.order_items as item
      set quantity = (v_line->>'quantity')::numeric,
        unit_price = case
          when v_line ? 'unit_price'
            then round((v_line->>'unit_price')::numeric, 2)
          else item.unit_price
        end,
        line_total = round(
          (case
            when v_line ? 'unit_price'
              then round((v_line->>'unit_price')::numeric, 2)
            else item.unit_price
          end) * (v_line->>'quantity')::numeric
        )
      where item.id = (v_line->>'id')::uuid and item.order_id = p_order_id;
    end if;
  end loop;

  select coalesce(sum(line_total), 0), count(*)
  into v_subtotal, v_count
  from public.order_items
  where order_id = p_order_id;
  if v_count = 0 then raise exception 'Đơn hàng cần có ít nhất một sản phẩm'; end if;
  if p_discount > v_subtotal then
    raise exception 'Giảm giá vượt quá tổng tiền hàng';
  end if;
  v_total := v_subtotal - p_discount;

  update public.orders
  set customer_name = trim(p_customer_name),
    customer_phone = coalesce(p_customer_phone, ''),
    customer_address = coalesce(p_customer_address, ''),
    subtotal = v_subtotal,
    discount = p_discount,
    total = v_total
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'subtotal', v_subtotal,
    'discount', p_discount,
    'total', v_total
  );
end;
$$;

revoke all on function public.edit_order(uuid, jsonb, numeric, text, text, text)
  from public, anon;
grant execute on function public.edit_order(uuid, jsonb, numeric, text, text, text)
  to authenticated;
