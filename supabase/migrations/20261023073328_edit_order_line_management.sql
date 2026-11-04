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
  v_product public.products;
  v_line jsonb;
  v_item record;
  v_new_item_id uuid;
  v_next_display_order integer;
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
      or (line.value ? 'id') = (line.value ? 'product_id')
      or (line.value ? 'id' and coalesce(line.value->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or (line.value ? 'product_id' and coalesce(line.value->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or coalesce(line.value->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
      or coalesce(line.value->>'unit_price', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
  ) then
    raise exception 'Số lượng hoặc đơn giá sản phẩm không hợp lệ';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where (line.value->>'quantity')::numeric <= 0
      or (line.value->>'quantity')::numeric > 100000000
      or (line.value->>'unit_price')::numeric > 999999999999.99
  ) then
    raise exception 'Số lượng hoặc đơn giá sản phẩm vượt quá giới hạn';
  end if;
  if exists (
    select line.value->>'id'
    from jsonb_array_elements(p_lines) as line(value)
    where line.value ? 'id'
    group by line.value->>'id'
    having count(*) > 1
  ) then
    raise exception 'Dữ liệu sản phẩm bị trùng';
  end if;
  if exists (
    select line.value->>'product_id'
    from jsonb_array_elements(p_lines) as line(value)
    where line.value ? 'product_id'
    group by line.value->>'product_id'
    having count(*) > 1
  ) then
    raise exception 'Sản phẩm mới bị trùng';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    left join public.order_items item
      on item.id = (line.value->>'id')::uuid and item.order_id = p_order_id
    where line.value ? 'id' and item.id is null
  ) then
    raise exception 'Đơn hàng có sản phẩm không hợp lệ';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    join public.order_items item on item.id = (line.value->>'id')::uuid
    where line.value ? 'id' and item.product_id is null
  ) then
    raise exception 'Sản phẩm đã bị xóa khỏi danh mục';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    left join public.products product on product.id = (line.value->>'product_id')::uuid
    where line.value ? 'product_id'
      and (product.id is null or not product.is_active)
  ) then
    raise exception 'Sản phẩm mới không còn kinh doanh';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where line.value ? 'product_id'
  ) and not public.user_has_permission('products.read') then
    raise exception 'Không có quyền xem hàng hóa để thêm vào đơn' using errcode = '42501';
  end if;

  -- Lock combo definitions first, then all stock rows in a stable order. This
  -- serializes edits with checkout and catalog updates without stale stock math.
  perform product.id
  from public.products product
  where product.kind = 'combo'
    and (
      product.id in (
        select item.product_id from public.order_items item
        where item.order_id = p_order_id and item.product_id is not null
      )
      or product.id in (
        select (line.value->>'product_id')::uuid
        from jsonb_array_elements(p_lines) as line(value)
        where line.value ? 'product_id'
      )
    )
  order by product.id
  for update;

  perform product.id
  from public.products product
  where product.id in (
    select item.product_id from public.order_items item
    join public.products current_product on current_product.id = item.product_id
      and current_product.kind = 'product'
    where item.order_id = p_order_id
    union
    select component.product_id from public.order_item_components component
    join public.order_items item on item.id = component.order_item_id
    where item.order_id = p_order_id and component.product_id is not null
    union
    select product.id
    from jsonb_array_elements(p_lines) as line(value)
    join public.products product on product.id = (line.value->>'product_id')::uuid
      and product.kind = 'product'
    where line.value ? 'product_id'
    union
    select bundle_item.product_id
    from jsonb_array_elements(p_lines) as line(value)
    join public.product_bundle_items bundle_item
      on bundle_item.bundle_product_id = (line.value->>'product_id')::uuid
    where line.value ? 'product_id'
  )
  order by product.id
  for update;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    join public.products combo on combo.id = (line.value->>'product_id')::uuid
      and combo.kind = 'combo'
    where line.value ? 'product_id'
      and (
        not exists (
          select 1 from public.product_bundle_items bundle_item
          where bundle_item.bundle_product_id = combo.id
        )
        or exists (
          select 1
          from public.product_bundle_items bundle_item
          left join public.products component on component.id = bundle_item.product_id
          where bundle_item.bundle_product_id = combo.id
            and (component.id is null or not component.is_active or component.kind <> 'product')
        )
      )
  ) then
    raise exception 'Combo mới không còn hàng hóa thành phần khả dụng';
  end if;

  perform set_config('app.checkout_order_id', p_order_id::text, true);
  perform set_config('app.inventory_reason', 'Điều chỉnh đơn hàng', true);
  for v_item in
    with requested_existing as (
      select (line.value->>'id')::uuid as order_item_id,
        (line.value->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_lines) as line(value)
      where line.value ? 'id'
    ), old_deltas as (
      select item.product_id,
        item.quantity - coalesce(requested.quantity, 0) as quantity
      from public.order_items item
      join public.products product on product.id = item.product_id
        and product.kind = 'product'
      left join requested_existing requested on requested.order_item_id = item.id
      where item.order_id = p_order_id
      union all
      select component.product_id,
        component.quantity_per_bundle * (item.quantity - coalesce(requested.quantity, 0)) as quantity
      from public.order_items item
      join public.order_item_components component on component.order_item_id = item.id
      left join requested_existing requested on requested.order_item_id = item.id
      where item.order_id = p_order_id and component.product_id is not null
    ), new_deltas as (
      select product.id as product_id, (line.value->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_lines) as line(value)
      join public.products product on product.id = (line.value->>'product_id')::uuid
        and product.kind = 'product'
      where line.value ? 'product_id'
      union all
      select bundle_item.product_id,
        bundle_item.quantity_per_bundle * (line.value->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_lines) as line(value)
      join public.products combo on combo.id = (line.value->>'product_id')::uuid
        and combo.kind = 'combo'
      join public.product_bundle_items bundle_item on bundle_item.bundle_product_id = combo.id
      where line.value ? 'product_id'
    )
    select product_id, round(sum(quantity), 3) as quantity
    from (
      select product_id, quantity from old_deltas
      union all
      select product_id, -quantity from new_deltas
    ) as stock_delta
    group by product_id
    having round(sum(quantity), 3) <> 0
    order by product_id
  loop
    update public.products
    set stock = stock + v_item.quantity
    where id = v_item.product_id;
  end loop;

  -- Omitted existing IDs are deletions. Cascades remove their snapshots while
  -- preserving the order and its remaining item history.
  delete from public.order_items item
  where item.order_id = p_order_id
    and not exists (
      select 1 from jsonb_array_elements(p_lines) as line(value)
      where line.value ? 'id' and (line.value->>'id')::uuid = item.id
    );

  for v_line in
    select value from jsonb_array_elements(p_lines) as lines(value)
    where value ? 'id'
  loop
    update public.order_items as item
    set quantity = (v_line->>'quantity')::numeric,
      unit_price = round((v_line->>'unit_price')::numeric, 2),
      line_total = round(round((v_line->>'unit_price')::numeric, 2) * (v_line->>'quantity')::numeric)
    where item.id = (v_line->>'id')::uuid and item.order_id = p_order_id;
  end loop;

  select coalesce(max(display_order), -1) + 1
  into v_next_display_order
  from public.order_items
  where order_id = p_order_id;

  for v_line in
    select lines.value
    from jsonb_array_elements(p_lines) with ordinality as lines(value, position)
    where lines.value ? 'product_id'
    order by lines.position
  loop
    select * into v_product
    from public.products product
    where product.id = (v_line->>'product_id')::uuid and product.is_active;
    if not found then raise exception 'Sản phẩm mới không còn kinh doanh'; end if;

    insert into public.order_items(
      order_id, display_order, product_id, sku, product_name, unit,
      quantity, unit_price, line_total
    ) values (
      p_order_id, v_next_display_order, v_product.id, v_product.sku,
      v_product.name, v_product.unit, (v_line->>'quantity')::numeric,
      round((v_line->>'unit_price')::numeric, 2),
      round(round((v_line->>'unit_price')::numeric, 2) * (v_line->>'quantity')::numeric)
    ) returning id into v_new_item_id;

    if v_product.kind = 'combo' then
      insert into public.order_item_components(
        order_item_id, product_id, sku, product_name, unit, quantity_per_bundle
      )
      select v_new_item_id, bundle_item.product_id, component.sku,
        component.name, component.unit, bundle_item.quantity_per_bundle
      from public.product_bundle_items bundle_item
      join public.products component on component.id = bundle_item.product_id
      where bundle_item.bundle_product_id = v_product.id
      order by bundle_item.product_id;
    end if;
    v_next_display_order := v_next_display_order + 1;
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
