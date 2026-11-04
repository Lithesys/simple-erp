alter table public.products
  add column kind text not null default 'product'
  check (kind in ('product', 'combo'));

create table public.product_bundle_items (
  bundle_product_id uuid not null references public.products(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_per_bundle numeric(14, 3) not null check (quantity_per_bundle > 0),
  primary key (bundle_product_id, product_id),
  check (bundle_product_id <> product_id)
);
create index product_bundle_items_product_idx on public.product_bundle_items(product_id);

create table public.order_item_components (
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  product_name text not null,
  unit text not null,
  quantity_per_bundle numeric(14, 3) not null check (quantity_per_bundle > 0),
  primary key (order_item_id, sku)
);
create index order_item_components_product_idx on public.order_item_components(product_id);

alter table public.product_bundle_items enable row level security;
alter table public.order_item_components enable row level security;
revoke all on public.product_bundle_items, public.order_item_components from public, anon, authenticated;
grant select on public.product_bundle_items, public.order_item_components to authenticated;

create policy product_bundle_items_read on public.product_bundle_items
  for select to authenticated using (
    public.user_has_permission('products.read') or
    public.user_has_permission('sales.create')
  );
create policy order_item_components_read on public.order_item_components
  for select to authenticated using (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id and (
        (o.cashier_id = (select auth.uid()) and public.user_has_permission('orders.read_own')) or
        public.user_has_permission('orders.read_all')
      )
    )
  );

create function public.prevent_product_kind_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.kind is distinct from new.kind then
    raise exception 'Không thể đổi loại hàng hóa sau khi tạo';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_product_kind_change() from public, anon, authenticated;
create trigger prevent_product_kind_change_before_update
  before update of kind on public.products
  for each row execute function public.prevent_product_kind_change();

create function public.prevent_combo_stock_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.kind = 'combo' and new.stock is distinct from old.stock then
    raise exception 'Tồn kho combo được tính từ hàng hóa thành phần';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_combo_stock_change() from public, anon, authenticated;
create trigger prevent_combo_stock_change_before_update
  before update of stock on public.products
  for each row execute function public.prevent_combo_stock_change();

create function public.prevent_combo_purchase_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  if new.product_id is null then return new; end if;
  select kind into v_kind from public.products where id = new.product_id;
  if v_kind is distinct from 'product' then
    raise exception 'Chỉ được nhập mua hàng hóa thông thường';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_combo_purchase_item() from public, anon, authenticated;
create trigger prevent_combo_purchase_item_before_insert
  before insert on public.purchase_order_items
  for each row execute function public.prevent_combo_purchase_item();
create trigger prevent_combo_purchase_item_before_product_update
  before update of product_id on public.purchase_order_items
  for each row execute function public.prevent_combo_purchase_item();

create function public.validate_product_bundle_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_bundle_kind text; v_product_kind text;
begin
  select kind into v_bundle_kind from public.products where id = new.bundle_product_id;
  select kind into v_product_kind from public.products where id = new.product_id;
  if v_bundle_kind is distinct from 'combo' or v_product_kind is distinct from 'product' then
    raise exception 'Combo chỉ được chứa hàng hóa thông thường';
  end if;
  if new.quantity_per_bundle > 100000000 then
    raise exception 'Số lượng trong combo không hợp lệ';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_product_bundle_item() from public, anon, authenticated;
create trigger validate_product_bundle_item_before_write
  before insert or update on public.product_bundle_items
  for each row execute function public.validate_product_bundle_item();

create function public.create_product_combo(
  p_name text,
  p_unit text,
  p_items jsonb,
  p_prices jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products;
  v_item jsonb;
  v_price jsonb;
  v_quantity numeric(14, 3);
  v_amount numeric(14, 2);
begin
  if auth.uid() is null or not public.user_has_permission('products.create') then
    raise exception 'Không có quyền tạo combo' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null or length(trim(p_name)) > 300
    or length(coalesce(trim(p_unit), '')) > 100
  then
    raise exception 'Tên combo hoặc đơn vị tính không hợp lệ';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Danh sách hàng hóa trong combo không hợp lệ';
  end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Combo cần ít nhất một hàng hóa'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as line(value)
    where jsonb_typeof(line.value) <> 'object'
      or coalesce(line.value->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(line.value->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
  ) then
    raise exception 'Hàng hóa hoặc số lượng trong combo không hợp lệ';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct (line.value->>'product_id')::uuid) from jsonb_array_elements(p_items) as line(value)) then
    raise exception 'Hàng hóa trong combo bị trùng';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as line(value)
    left join public.products p on p.id = (line.value->>'product_id')::uuid
    where p.id is null or not p.is_active or p.kind <> 'product'
      or (line.value->>'quantity')::numeric <= 0
      or (line.value->>'quantity')::numeric > 100000000
  ) then
    raise exception 'Chỉ được chọn hàng hóa đang kinh doanh với số lượng hợp lệ';
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    raise exception 'Danh sách bảng giá combo không hợp lệ';
  end if;
  if jsonb_array_length(p_prices) <> (select count(*) from public.price_lists where is_active) then
    raise exception 'Cần thiết lập giá cho tất cả bảng giá đang hoạt động';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_prices) as line(value)
    where jsonb_typeof(line.value) <> 'object'
      or coalesce(line.value->>'price_list_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(line.value->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
  ) then
    raise exception 'Bảng giá hoặc giá combo không hợp lệ';
  end if;
  if (select count(*) from jsonb_array_elements(p_prices)) <>
     (select count(distinct (line.value->>'price_list_id')::uuid) from jsonb_array_elements(p_prices) as line(value)) then
    raise exception 'Bảng giá combo bị trùng';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_prices) as line(value)
    left join public.price_lists pl on pl.id = (line.value->>'price_list_id')::uuid and pl.is_active
    where pl.id is null or (line.value->>'price')::numeric < 0
  ) or exists (
    select 1 from public.price_lists pl
    where pl.is_active and not exists (
      select 1 from jsonb_array_elements(p_prices) as line(value)
      where (line.value->>'price_list_id')::uuid = pl.id
    )
  ) then
    raise exception 'Cần thiết lập giá hợp lệ cho tất cả bảng giá đang hoạt động';
  end if;

  insert into public.products(name, unit, stock, kind)
  values (trim(p_name), coalesce(nullif(trim(p_unit), ''), 'cái'), 0, 'combo')
  returning * into v_product;
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    v_quantity := (v_item->>'quantity')::numeric;
    insert into public.product_bundle_items(bundle_product_id, product_id, quantity_per_bundle)
    values (v_product.id, (v_item->>'product_id')::uuid, v_quantity);
  end loop;
  for v_price in select value from jsonb_array_elements(p_prices) order by value->>'price_list_id' loop
    v_amount := (v_price->>'price')::numeric;
    insert into public.product_prices(product_id, price_list_id, price)
    values (v_product.id, (v_price->>'price_list_id')::uuid, v_amount);
  end loop;
  return v_product.id;
end;
$$;
revoke all on function public.create_product_combo(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_product_combo(text, text, jsonb, jsonb) to authenticated;

create function public.save_product_combo_items(p_bundle_product_id uuid, p_items jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_bundle public.products;
  v_item jsonb;
  v_quantity numeric(14, 3);
begin
  if auth.uid() is null or not public.user_has_permission('products.update') then
    raise exception 'Không có quyền chỉnh sửa combo' using errcode = '42501';
  end if;
  select * into v_bundle from public.products where id = p_bundle_product_id for update;
  if not found or v_bundle.kind <> 'combo' then raise exception 'Không tìm thấy combo'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Danh sách hàng hóa trong combo không hợp lệ';
  end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Combo cần ít nhất một hàng hóa'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as line(value)
    where jsonb_typeof(line.value) <> 'object'
      or coalesce(line.value->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(line.value->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
  ) then
    raise exception 'Hàng hóa hoặc số lượng trong combo không hợp lệ';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct (line.value->>'product_id')::uuid) from jsonb_array_elements(p_items) as line(value)) then
    raise exception 'Hàng hóa trong combo bị trùng';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as line(value)
    left join public.products p on p.id = (line.value->>'product_id')::uuid
    where p.id is null or not p.is_active or p.kind <> 'product'
      or (line.value->>'quantity')::numeric <= 0
      or (line.value->>'quantity')::numeric > 100000000
  ) then
    raise exception 'Chỉ được chọn hàng hóa đang kinh doanh với số lượng hợp lệ';
  end if;

  delete from public.product_bundle_items where bundle_product_id = p_bundle_product_id;
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    v_quantity := (v_item->>'quantity')::numeric;
    insert into public.product_bundle_items(bundle_product_id, product_id, quantity_per_bundle)
    values (v_bundle.id, (v_item->>'product_id')::uuid, v_quantity);
  end loop;
end;
$$;
revoke all on function public.save_product_combo_items(uuid, jsonb) from public, anon;
grant execute on function public.save_product_combo_items(uuid, jsonb) to authenticated;

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
  v_order_item_id uuid;
  v_list public.price_lists;
  v_line jsonb;
  v_part jsonb;
  v_component record;
  v_product public.products;
  v_price numeric(14, 2);
  v_requested_price numeric(14, 2);
  v_quantity numeric(14, 3);
  v_stock numeric(14, 3);
  v_parts jsonb;
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
  select * into v_existing from public.orders
  where cashier_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'total', v_existing.total);
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Danh sách sản phẩm không hợp lệ';
  end if;
  if jsonb_array_length(p_lines) = 0 then raise exception 'Đơn hàng chưa có sản phẩm'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where jsonb_typeof(line.value) <> 'object'
      or coalesce(line.value->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(line.value->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
  ) then raise exception 'Sản phẩm hoặc số lượng không hợp lệ'; end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
     (select count(distinct (line.value->>'product_id')::uuid) from jsonb_array_elements(p_lines) as line(value)) then
    raise exception 'Sản phẩm trong đơn hàng bị trùng';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where (line.value->>'quantity')::numeric <= 0 or (line.value->>'quantity')::numeric > 100000000
  ) then raise exception 'Số lượng không hợp lệ'; end if;

  -- Lock combo definitions first, then all inventory rows in a stable order.
  perform p.id from public.products p
  where p.id in (select (line.value->>'product_id')::uuid from jsonb_array_elements(p_lines) as line(value))
    and p.kind = 'combo'
  order by p.id for update;
  perform p.id from public.products p
  where p.id in (
    select (line.value->>'product_id')::uuid
    from jsonb_array_elements(p_lines) as line(value)
    join public.products sold on sold.id = (line.value->>'product_id')::uuid
    where sold.kind = 'product'
    union
    select part.product_id from public.product_bundle_items part
    where part.bundle_product_id in (
      select (line.value->>'product_id')::uuid
      from jsonb_array_elements(p_lines) as line(value)
    )
  )
  order by p.id for update;

  select * into v_list from public.price_lists where id = p_price_list_id and is_active;
  if not found then raise exception 'Bảng giá không còn hoạt động'; end if;
  v_name := nullif(trim(coalesce(p_customer_name, '')), '');
  if v_name is null then v_name := 'Khách lẻ'; end if;
  if length(v_name) > 300 or length(coalesce(p_customer_phone, '')) > 100
    or length(coalesce(p_customer_address, '')) > 1000
  then raise exception 'Thông tin khách hàng quá dài'; end if;

  for v_line in select value from jsonb_array_elements(p_lines) order by value->>'product_id' loop
    v_quantity := (v_line->>'quantity')::numeric;
    select * into v_product from public.products
    where id = (v_line->>'product_id')::uuid and is_active;
    if not found then raise exception 'Sản phẩm không còn hoạt động'; end if;
    select price into v_price from public.product_prices
    where product_id = v_product.id and price_list_id = v_list.id for share;
    if not found then raise exception 'Sản phẩm chưa có giá trong bảng giá'; end if;
    if v_line ? 'expected_price' and (v_line->>'expected_price')::numeric <> v_price then
      raise exception 'Giá của sản phẩm "%" đã thay đổi', v_product.name using errcode = 'P0001';
    end if;
    if v_line ? 'unit_price' then
      v_requested_price := (v_line->>'unit_price')::numeric;
      if v_requested_price is null or v_requested_price::text = 'NaN' or v_requested_price < 0 then
        raise exception 'Đơn giá không hợp lệ';
      end if;
      if v_requested_price is distinct from v_price then
        if not v_can_override_price then
          raise exception 'Không có quyền chỉnh sửa đơn giá' using errcode = '42501';
        end if;
        v_price := v_requested_price;
      end if;
    end if;

    v_parts := '[]'::jsonb;
    if v_product.kind = 'combo' then
      if not exists (select 1 from public.product_bundle_items where bundle_product_id = v_product.id) then
        raise exception 'Combo "%" chưa có hàng hóa thành phần', v_product.name;
      end if;
      if exists (
        select 1 from public.product_bundle_items part
        left join public.products component on component.id = part.product_id
        where part.bundle_product_id = v_product.id
          and (component.id is null or not component.is_active or component.kind <> 'product')
      ) then
        raise exception 'Hàng hóa trong combo "%" không còn kinh doanh', v_product.name;
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', part.product_id, 'sku', component.sku, 'product_name', component.name,
        'unit', component.unit, 'quantity_per_bundle', part.quantity_per_bundle
      ) order by part.product_id), '[]'::jsonb)
      into v_parts
      from public.product_bundle_items part
      join public.products component on component.id = part.product_id
      where part.bundle_product_id = v_product.id;
    end if;

    v_subtotal := v_subtotal + round(v_price * v_quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id, 'sku', v_product.sku, 'product_name', v_product.name,
      'unit', v_product.unit, 'quantity', v_quantity, 'unit_price', v_price,
      'line_total', round(v_price * v_quantity), 'bundle_parts', v_parts
    ));
  end loop;

  for v_component in
    with requested as (select value as item from jsonb_array_elements(v_items)),
    consumption as (
      select (item->>'product_id')::uuid as product_id, (item->>'quantity')::numeric as quantity
      from requested where jsonb_array_length(coalesce(item->'bundle_parts', '[]'::jsonb)) = 0
      union all
      select (part.value->>'product_id')::uuid,
        (part.value->>'quantity_per_bundle')::numeric * (requested.item->>'quantity')::numeric
      from requested cross join lateral jsonb_array_elements(requested.item->'bundle_parts') as part(value)
    )
    select product_id, round(sum(quantity), 3) as quantity
    from consumption group by product_id order by product_id
  loop
    select stock into v_stock from public.products where id = v_component.product_id;
    if v_stock < v_component.quantity then
      select name into v_name from public.products where id = v_component.product_id;
      raise exception 'Tồn kho không đủ cho "%"', v_name;
    end if;
  end loop;

  v_discount := coalesce(round(p_discount), 0);
  if v_discount < 0 or v_discount > v_subtotal then raise exception 'Mức giảm giá không hợp lệ'; end if;
  v_total := v_subtotal - v_discount;
  insert into public.orders(
    idempotency_key, cashier_id, price_list_id, price_list_name, customer_name,
    customer_phone, customer_address, subtotal, discount, total
  ) values (
    p_idempotency_key, v_user, v_list.id, v_list.name, v_name,
    trim(coalesce(p_customer_phone, '')), trim(coalesce(p_customer_address, '')),
    v_subtotal, v_discount, v_total
  ) on conflict (cashier_id, idempotency_key) do nothing returning * into v_order;
  if v_order.id is null then
    select * into v_existing from public.orders where cashier_id = v_user and idempotency_key = p_idempotency_key;
    return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'total', v_existing.total);
  end if;

  perform set_config('app.checkout_order_id', v_order.id::text, true);
  perform set_config('app.inventory_reason', 'Bán hàng', true);
  for v_line in select value from jsonb_array_elements(v_items) loop
    insert into public.order_items(order_id, product_id, sku, product_name, unit, quantity, unit_price, line_total)
    values (
      v_order.id, (v_line->>'product_id')::uuid, v_line->>'sku', v_line->>'product_name',
      v_line->>'unit', (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric,
      (v_line->>'line_total')::numeric
    ) returning id into v_order_item_id;
    for v_part in select value from jsonb_array_elements(v_line->'bundle_parts') loop
      insert into public.order_item_components(
        order_item_id, product_id, sku, product_name, unit, quantity_per_bundle
      ) values (
        v_order_item_id, (v_part->>'product_id')::uuid, v_part->>'sku', v_part->>'product_name',
        v_part->>'unit', (v_part->>'quantity_per_bundle')::numeric
      );
    end loop;
  end loop;
  for v_component in
    with requested as (select value as item from jsonb_array_elements(v_items)),
    consumption as (
      select (item->>'product_id')::uuid as product_id, (item->>'quantity')::numeric as quantity
      from requested where jsonb_array_length(coalesce(item->'bundle_parts', '[]'::jsonb)) = 0
      union all
      select (part.value->>'product_id')::uuid,
        (part.value->>'quantity_per_bundle')::numeric * (requested.item->>'quantity')::numeric
      from requested cross join lateral jsonb_array_elements(requested.item->'bundle_parts') as part(value)
    )
    select product_id, round(sum(quantity), 3) as quantity
    from consumption group by product_id order by product_id
  loop
    update public.products set stock = stock - v_component.quantity where id = v_component.product_id;
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
  v_stock numeric(14, 3);
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
  if jsonb_array_length(p_lines) = 0 then raise exception 'Đơn hàng cần có ít nhất một sản phẩm'; end if;
  if p_discount is null or p_discount < 0 then raise exception 'Giảm giá không hợp lệ'; end if;
  if coalesce(trim(p_customer_name), '') = '' or length(p_customer_name) > 300
     or length(coalesce(p_customer_phone, '')) > 100 or length(coalesce(p_customer_address, '')) > 1000 then
    raise exception 'Thông tin khách hàng không hợp lệ';
  end if;
  select * into v_order from public.orders where id = p_order_id and status = 'completed' for update;
  if not found then raise exception 'Không tìm thấy đơn hàng'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where coalesce(line.value->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(line.value->>'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
  ) then raise exception 'Số lượng sản phẩm không hợp lệ'; end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
     (select count(distinct (line.value->>'id')::uuid) from jsonb_array_elements(p_lines) as line(value)) then
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

  perform p.id from public.products p where p.id in (
    select oi.product_id from public.order_items oi where oi.order_id = p_order_id and oi.product_id is not null
    union
    select component.product_id
    from public.order_item_components component
    join public.order_items oi on oi.id = component.order_item_id
    where oi.order_id = p_order_id and component.product_id is not null
  ) order by p.id for update;

  perform set_config('app.checkout_order_id', p_order_id::text, true);
  perform set_config('app.inventory_reason', 'Điều chỉnh đơn hàng', true);
  for v_item in
    with requested as (
      select (line.value->>'id')::uuid as order_item_id, (line.value->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_lines) as line(value)
    ),
    stock_delta as (
      select oi.product_id, oi.quantity - coalesce(requested.quantity, 0) as quantity
      from public.order_items oi
      join public.products product on product.id = oi.product_id and product.kind = 'product'
      left join requested on requested.order_item_id = oi.id
      where oi.order_id = p_order_id
      union all
      select component.product_id,
        component.quantity_per_bundle * (oi.quantity - coalesce(requested.quantity, 0)) as quantity
      from public.order_items oi
      join public.products combo on combo.id = oi.product_id and combo.kind = 'combo'
      join public.order_item_components component on component.order_item_id = oi.id
      left join requested on requested.order_item_id = oi.id
      where oi.order_id = p_order_id and component.product_id is not null
    )
    select product_id, round(sum(quantity), 3) as quantity
    from stock_delta group by product_id order by product_id
  loop
    select stock into v_stock from public.products where id = v_item.product_id;
    if v_item.quantity < 0 and v_stock < -v_item.quantity then
      raise exception 'Tồn kho không đủ để tăng số lượng đơn hàng';
    end if;
    update public.products set stock = stock + v_item.quantity where id = v_item.product_id;
  end loop;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if (v_line->>'quantity')::numeric = 0 then
      delete from public.order_items where id = (v_line->>'id')::uuid and order_id = p_order_id;
    else
      update public.order_items set quantity = (v_line->>'quantity')::numeric,
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
end;
$$;
revoke all on function public.edit_order(uuid, jsonb, numeric, text, text, text) from public, anon;
grant execute on function public.edit_order(uuid, jsonb, numeric, text, text, text) to authenticated;

create or replace function public.delete_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_item record;
begin
  if auth.uid() is null or not public.user_has_permission('orders.delete') then
    raise exception 'Không có quyền xóa đơn hàng' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = p_order_id and status = 'completed' for update;
  if not found then raise exception 'Không tìm thấy đơn hàng hoặc đơn đã được xử lý'; end if;

  perform p.id from public.products p where p.id in (
    select oi.product_id from public.order_items oi where oi.order_id = p_order_id and oi.product_id is not null
    union
    select component.product_id from public.order_item_components component
    join public.order_items oi on oi.id = component.order_item_id
    where oi.order_id = p_order_id and component.product_id is not null
  ) order by p.id for update;

  perform set_config('app.checkout_order_id', p_order_id::text, true);
  perform set_config('app.inventory_reason', 'Hoàn kho do xóa đơn hàng', true);
  for v_item in
    with restoration as (
      select oi.product_id, sum(oi.quantity) as quantity
      from public.order_items oi
      join public.products product on product.id = oi.product_id and product.kind = 'product'
      where oi.order_id = p_order_id
      group by oi.product_id
      union all
      select component.product_id, sum(oi.quantity * component.quantity_per_bundle) as quantity
      from public.order_item_components component
      join public.order_items oi on oi.id = component.order_item_id
      where oi.order_id = p_order_id and component.product_id is not null
      group by component.product_id
    )
    select product_id, round(sum(quantity), 3) as quantity
    from restoration group by product_id order by product_id
  loop
    update public.products set stock = stock + v_item.quantity where id = v_item.product_id;
  end loop;
  delete from public.orders where id = p_order_id;
end;
$$;
revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated;

create or replace function public.snapshot_order_item_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_unit_cost numeric(14, 2);
begin
  if tg_op = 'INSERT' then
    select case when product.kind = 'combo' then
      coalesce((
        select sum(part.quantity_per_bundle * coalesce(component_cost.cost, 0))
        from public.product_bundle_items part
        left join public.product_costs component_cost on component_cost.product_id = part.product_id
        where part.bundle_product_id = product.id
      ), 0)
      else coalesce(product_cost.cost, 0)
    end into v_unit_cost
    from public.order_items oi
    join public.products product on product.id = oi.product_id
    left join public.product_costs product_cost on product_cost.product_id = product.id
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
