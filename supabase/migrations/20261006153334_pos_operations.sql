-- Operational workflows for the POS: purchase receipts, stock history, exports,
-- safe order reversals, and permissions for those workflows.

create sequence public.purchase_number_seq;
revoke all on sequence public.purchase_number_seq from public, anon, authenticated;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null unique default (
    'PN-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' ||
    lpad(nextval('public.purchase_number_seq')::text, 6, '0')
  ),
  idempotency_key uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  received_by uuid references auth.users(id) on delete set null,
  purchased_at timestamptz not null default now(),
  received_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'received')),
  total numeric(14, 0) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  unique (created_by, idempotency_key)
);
create index purchase_orders_purchased_at_idx on public.purchase_orders(purchased_at desc);
create index purchase_orders_status_idx on public.purchase_orders(status, purchased_at desc);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  product_name text not null,
  unit text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  line_total numeric(14, 0) not null check (line_total >= 0)
);
create index purchase_order_items_order_idx on public.purchase_order_items(purchase_order_id);
create index purchase_order_items_product_idx on public.purchase_order_items(product_id);

alter table public.inventory_movements
  add column purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  add column stock_after numeric(14, 3);
create index inventory_movements_product_created_idx
  on public.inventory_movements(product_id, created_at desc, id desc);
create index inventory_movements_purchase_order_idx
  on public.inventory_movements(purchase_order_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
revoke all on public.purchase_orders, public.purchase_order_items from anon, authenticated;
grant select on public.purchase_orders, public.purchase_order_items to authenticated;

create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using (public.user_has_permission('purchases.manage'));
create policy purchase_order_items_read on public.purchase_order_items for select to authenticated
  using (
    public.user_has_permission('purchases.manage')
    and exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_id
    )
  );
create policy products_read_for_purchasing on public.products for select to authenticated
  using (is_active and public.user_has_permission('purchases.manage'));

update public.roles
set permissions = array(
  select distinct permission
  from unnest(permissions || array['orders.delete', 'purchases.manage']) as permission
)
where is_system and name = 'Admin'
  and (not ('orders.delete' = any(permissions)) or not ('purchases.manage' = any(permissions)));

create or replace function public.record_stock_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_purchase_order_id uuid;
  v_reason text;
begin
  if new.stock is distinct from old.stock then
    v_order_id := nullif(current_setting('app.checkout_order_id', true), '')::uuid;
    v_purchase_order_id := nullif(current_setting('app.purchase_order_id', true), '')::uuid;
    v_reason := coalesce(
      nullif(current_setting('app.inventory_reason', true), ''),
      case when v_order_id is null then 'Điều chỉnh tồn kho' else 'Bán hàng' end
    );
    insert into public.inventory_movements(
      product_id, order_id, purchase_order_id, quantity_change, stock_after, reason, actor_id
    )
    values (
      new.id, v_order_id, v_purchase_order_id, new.stock - old.stock, new.stock, v_reason, auth.uid()
    );
  end if;
  return new;
end $$;
revoke all on function public.record_stock_change() from public, anon, authenticated;

-- Lock every cart's products in the same order. This serializes sales of a shared
-- product and avoids deadlocks when carts contain the same products in a different order.
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
  v_quantity numeric(14, 3);
  v_subtotal numeric(14, 0) := 0;
  v_discount numeric(14, 0);
  v_total numeric(14, 0);
  v_items jsonb := '[]'::jsonb;
  v_name text;
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

create or replace function public.delete_price_list(p_price_list_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('price_lists.manage') then
    raise exception 'Không có quyền quản lý bảng giá' using errcode = '42501';
  end if;
  perform 1 from public.price_lists where id = p_price_list_id for update;
  if not found then raise exception 'Không tìm thấy bảng giá'; end if;
  if exists (select 1 from public.price_lists where id = p_price_list_id and is_default) then
    raise exception 'Không thể xóa bảng giá mặc định. Hãy chọn bảng giá mặc định khác trước.';
  end if;
  delete from public.price_lists where id = p_price_list_id;
end $$;
revoke all on function public.delete_price_list(uuid) from public, anon;
grant execute on function public.delete_price_list(uuid) to authenticated;

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

create or replace function public.orders_summary(
  p_query text default '',
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'count', count(*),
    'subtotal', coalesce(sum(o.subtotal), 0),
    'total', coalesce(sum(o.total), 0)
  )
  from public.orders o
  where o.status = 'completed'
    and (
      nullif(trim(coalesce(p_query, '')), '') is null
      or position(lower(trim(p_query)) in lower(o.order_no || ' ' || o.customer_name)) > 0
    )
    and (
      p_from is null
      or o.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
    )
    and (
      p_to is null
      or o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    );
$$;
revoke all on function public.orders_summary(text, date, date) from public, anon;
grant execute on function public.orders_summary(text, date, date) to authenticated;

create or replace function public.create_purchase_order(
  p_idempotency_key uuid,
  p_purchased_at timestamptz,
  p_lines jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_existing public.purchase_orders;
  v_order public.purchase_orders;
  v_line jsonb;
  v_product public.products;
  v_quantity numeric(14, 3);
  v_unit_cost numeric(14, 2);
  v_total numeric(14, 0) := 0;
begin
  if v_user is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền quản lý nhập hàng' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Thiếu mã yêu cầu nhập hàng'; end if;
  select * into v_existing
  from public.purchase_orders
  where created_by = v_user and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'purchase_order_id', v_existing.id, 'purchase_no', v_existing.purchase_no, 'total', v_existing.total
    );
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Đơn nhập hàng chưa có sản phẩm';
  end if;

  insert into public.purchase_orders(idempotency_key, created_by, purchased_at, status, total)
  values (p_idempotency_key, v_user, coalesce(p_purchased_at, now()), 'pending', 0)
  on conflict (created_by, idempotency_key) do nothing
  returning * into v_order;
  if v_order.id is null then
    select * into v_existing
    from public.purchase_orders
    where created_by = v_user and idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'purchase_order_id', v_existing.id, 'purchase_no', v_existing.purchase_no, 'total', v_existing.total
    );
  end if;

  for v_line in
    select value
    from jsonb_array_elements(p_lines)
    order by value ->> 'product_id'
  loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric;
    if v_quantity <= 0 or v_quantity > 100000000 then raise exception 'Số lượng nhập không hợp lệ'; end if;
    if v_unit_cost < 0 or v_unit_cost > 999999999999 then raise exception 'Giá nhập không hợp lệ'; end if;
    select * into v_product
    from public.products
    where id = (v_line ->> 'product_id')::uuid and is_active
    for share;
    if not found then raise exception 'Sản phẩm không tồn tại hoặc đã ngừng kinh doanh'; end if;

    v_total := v_total + round(v_unit_cost * v_quantity);
    insert into public.purchase_order_items(
      purchase_order_id, product_id, sku, product_name, unit, quantity, unit_cost, line_total
    )
    values (
      v_order.id, v_product.id, v_product.sku, v_product.name, v_product.unit,
      v_quantity, v_unit_cost, round(v_unit_cost * v_quantity)
    );
  end loop;

  update public.purchase_orders set total = v_total where id = v_order.id;
  return jsonb_build_object(
    'purchase_order_id', v_order.id, 'purchase_no', v_order.purchase_no, 'total', v_total
  );
end $$;
revoke all on function public.create_purchase_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.create_purchase_order(uuid, timestamptz, jsonb) to authenticated;

create or replace function public.receive_purchase_order(p_purchase_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.purchase_orders;
  v_item record;
begin
  if auth.uid() is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền duyệt nhập hàng' using errcode = '42501';
  end if;
  select * into v_order
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found then raise exception 'Không tìm thấy đơn nhập hàng'; end if;
  if v_order.status <> 'pending' then raise exception 'Đơn nhập hàng đã được duyệt'; end if;
  if exists (
    select 1 from public.purchase_order_items poi
    where poi.purchase_order_id = p_purchase_order_id and poi.product_id is null
  ) then
    raise exception 'Một sản phẩm trong đơn nhập không còn tồn tại';
  end if;

  perform 1
  from public.products p
  where p.id in (
    select distinct poi.product_id
    from public.purchase_order_items poi
    where poi.purchase_order_id = p_purchase_order_id and poi.product_id is not null
  )
  order by p.id
  for update;

  perform set_config('app.purchase_order_id', p_purchase_order_id::text, true);
  perform set_config('app.inventory_reason', 'Nhập hàng', true);
  for v_item in
    select poi.product_id,
      sum(poi.quantity) as quantity,
      sum(poi.quantity * poi.unit_cost) / nullif(sum(poi.quantity), 0) as weighted_cost
    from public.purchase_order_items poi
    where poi.purchase_order_id = p_purchase_order_id and poi.product_id is not null
    group by poi.product_id
    order by poi.product_id
  loop
    update public.products
    set stock = stock + v_item.quantity
    where id = v_item.product_id;
    if not found then raise exception 'Một sản phẩm trong đơn nhập không còn tồn tại'; end if;

    insert into public.product_costs(product_id, cost)
    values (v_item.product_id, v_item.weighted_cost)
    on conflict (product_id) do update set cost = excluded.cost, updated_at = now();
  end loop;

  update public.purchase_orders
  set status = 'received', received_at = now(), received_by = auth.uid()
  where id = p_purchase_order_id;
end $$;
revoke all on function public.receive_purchase_order(uuid) from public, anon;
grant execute on function public.receive_purchase_order(uuid) to authenticated;

create or replace function public.get_product_inventory_history(p_product_id uuid)
returns table(
  id uuid,
  created_at timestamptz,
  reason text,
  quantity_change numeric,
  stock_after numeric,
  counterparty text,
  actor_name text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    public.user_has_permission('products.read') or public.user_has_permission('products.update')
  ) then
    raise exception 'Không có quyền xem lịch sử hàng hóa' using errcode = '42501';
  end if;
  return query
  select m.id, m.created_at, m.reason, m.quantity_change,
    coalesce(
      m.stock_after,
      p.stock - coalesce((
        select sum(later.quantity_change)
        from public.inventory_movements later
        where later.product_id = m.product_id
          and (later.created_at > m.created_at or (later.created_at = m.created_at and later.id > m.id))
      ), 0)
    ) as stock_after,
    coalesce(o.customer_name, po.purchase_no, '—') as counterparty,
    coalesce(nullif(actor.display_name, ''), '—') as actor_name
  from public.inventory_movements m
  left join public.products p on p.id = m.product_id
  left join public.orders o on o.id = m.order_id
  left join public.purchase_orders po on po.id = m.purchase_order_id
  left join public.profiles actor on actor.id = m.actor_id
  where m.product_id = p_product_id
  order by m.created_at desc, m.id desc
  limit 200;
end $$;
revoke all on function public.get_product_inventory_history(uuid) from public, anon;
grant execute on function public.get_product_inventory_history(uuid) to authenticated;

create or replace function public.get_product_sales_summary(
  p_product_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_quantity numeric(14, 3);
  v_revenue numeric(14, 0);
begin
  if auth.uid() is null or not public.user_has_permission('products.read') then
    raise exception 'Không có quyền xem thống kê hàng hóa' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Khoảng thời gian thống kê không hợp lệ';
  end if;
  select coalesce(sum(oi.quantity), 0), coalesce(sum(oi.line_total), 0)
  into v_quantity, v_revenue
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.product_id = p_product_id
    and o.status = 'completed'
    and o.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
    and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
  return jsonb_build_object('quantity', v_quantity, 'revenue', v_revenue);
end $$;
revoke all on function public.get_product_sales_summary(uuid, date, date) from public, anon;
grant execute on function public.get_product_sales_summary(uuid, date, date) to authenticated;

create or replace function public.export_products(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or not public.user_has_permission('products.read') then
    raise exception 'Không có quyền xuất hàng hóa' using errcode = '42501';
  end if;
  if (p_from is null) <> (p_to is null) or (p_from is not null and p_from > p_to) then
    raise exception 'Khoảng thời gian xuất không hợp lệ';
  end if;
  select coalesce(jsonb_agg(row_data order by sort_name, sort_id), '[]'::jsonb)
  into v_rows
  from (
    select p.name as sort_name, p.id as sort_id,
      jsonb_build_object(
        'id', p.id,
        'sku', p.sku,
        'name', p.name,
        'unit', p.unit,
        'stock', p.stock,
        'is_active', p.is_active,
        'cost', case when public.user_has_permission('products.cost.read') then pc.cost else null end,
        'prices', coalesce((
          select jsonb_object_agg(l.id::text, pp.price)
          from public.product_prices pp
          join public.price_lists l on l.id = pp.price_list_id
          where pp.product_id = p.id and l.is_active
        ), '{}'::jsonb),
        'quantity_sold', case when p_from is null then 0 else coalesce((
          select sum(oi.quantity)
          from public.order_items oi
          join public.orders o on o.id = oi.order_id
          where oi.product_id = p.id
            and o.status = 'completed'
            and o.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
            and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
        ), 0) end
      ) as row_data
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
  ) products;
  return v_rows;
end $$;
revoke all on function public.export_products(date, date) from public, anon;
grant execute on function public.export_products(date, date) to authenticated;
