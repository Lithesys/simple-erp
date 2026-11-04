-- Customer directory is shared by authorized store staff; historical invoices keep snapshots.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 300),
  phone text not null default '' check (length(phone) <= 100),
  address text not null default '' check (length(address) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_name_id_idx on public.customers(name, id);
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
alter table public.customers enable row level security;
revoke all on public.customers from anon, authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;
create policy customers_read on public.customers for select to authenticated
using (public.user_has_permission('customers.read') or public.user_has_permission('customers.manage') or public.user_has_permission('sales.create'));
create policy customers_insert on public.customers for insert to authenticated with check (public.user_has_permission('customers.manage'));
create policy customers_update on public.customers for update to authenticated using (public.user_has_permission('customers.manage')) with check (public.user_has_permission('customers.manage'));
create policy customers_delete on public.customers for delete to authenticated using (public.user_has_permission('customers.manage'));
update public.roles set permissions = array_append(permissions, 'customers.read') where 'sales.create' = any(permissions) and not 'customers.read' = any(permissions);
update public.roles set permissions = array_append(permissions, 'customers.manage') where is_system and name = 'Admin' and not 'customers.manage' = any(permissions);

-- Literal substring search avoids interpolating user text into PostgREST filters.
create function public.search_customers(p_query text default '', p_offset integer default 0, p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as (
    select id, name, phone, address from public.customers
    where position(lower(trim(coalesce(p_query, ''))) in lower(name || ' ' || phone || ' ' || address)) > 0
  ), page as (
    select * from matches order by name, id offset greatest(0, p_offset) limit least(100, greatest(1, p_limit))
  ) select jsonb_build_object('rows', coalesce((select jsonb_agg(page) from page), '[]'::jsonb), 'total', (select count(*) from matches));
$$;
revoke all on function public.search_customers(text, integer, integer) from public, anon;
grant execute on function public.search_customers(text, integer, integer) to authenticated;

alter table public.orders add column customer_phone text not null default '' check (length(customer_phone) <= 100);
alter table public.orders add column customer_address text not null default '' check (length(customer_address) <= 1000);
-- Replace the old signature to avoid ambiguous default-argument overloads.
-- Old clients remain compatible because the additional arguments have defaults.
drop function public.checkout_order(uuid, uuid, text, numeric, jsonb);
create or replace function public.checkout_order(
  p_idempotency_key uuid,
  p_price_list_id uuid,
  p_customer_name text,
  p_discount numeric,
  p_lines jsonb,
  p_customer_phone text default '',
  p_customer_address text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_existing public.orders;
  v_order public.orders;
  v_list public.price_lists;
  v_line jsonb;
  v_product public.products;
  v_price numeric(14,2);
  v_quantity numeric(14,3);
  v_subtotal numeric(14,0) := 0;
  v_discount numeric(14,0);
  v_total numeric(14,0);
  v_items jsonb := '[]'::jsonb;
  v_name text;
begin
  if v_user is null or not public.user_has_permission('sales.create') then
    raise exception 'Không có quyền bán hàng' using errcode = '42501';
  end if;
  select * into v_existing from public.orders where cashier_id = v_user and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'total', v_existing.total); end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Đơn hàng chưa có sản phẩm'; end if;
  select * into v_list from public.price_lists where id = p_price_list_id and is_active;
  if not found then raise exception 'Bảng giá không còn hoạt động'; end if;
  v_name := nullif(trim(coalesce(p_customer_name, '')), '');
  if v_name is null then v_name := 'Khách lẻ'; end if;

  if length(v_name) > 300 or length(coalesce(p_customer_phone, '')) > 100 or length(coalesce(p_customer_address, '')) > 1000 then raise exception 'Thông tin khách hàng quá dài'; end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    if v_quantity <= 0 or v_quantity > 100000000 then raise exception 'Số lượng không hợp lệ'; end if;
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid and is_active for update;
    if not found then raise exception 'Sản phẩm không còn hoạt động'; end if;
    select price into v_price from public.product_prices where product_id = v_product.id and price_list_id = v_list.id for share;
    if not found then raise exception 'Sản phẩm chưa có giá trong bảng giá'; end if;
    if v_line ? 'expected_price' and (v_line ->> 'expected_price')::numeric <> v_price then
      raise exception 'Giá của sản phẩm "%" đã thay đổi', v_product.name using errcode = 'P0001';
    end if;
    v_subtotal := v_subtotal + round(v_price * v_quantity);
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'sku', v_product.sku,
      'product_name', v_product.name, 'unit', v_product.unit, 'quantity', v_quantity, 'unit_price', v_price,
      'line_total', round(v_price * v_quantity)));
  end loop;
  v_discount := coalesce(round(p_discount), 0);
  if v_discount < 0 or v_discount > v_subtotal then raise exception 'Mức giảm giá không hợp lệ'; end if;
  v_total := v_subtotal - v_discount;

  insert into public.orders(idempotency_key, cashier_id, price_list_id, price_list_name, customer_name, customer_phone, customer_address, subtotal, discount, total)
  values (p_idempotency_key, v_user, v_list.id, v_list.name, v_name, trim(coalesce(p_customer_phone, '')), trim(coalesce(p_customer_address, '')), v_subtotal, v_discount, v_total)
  on conflict (cashier_id, idempotency_key) do nothing returning * into v_order;
  if v_order.id is null then
    select * into v_existing from public.orders where cashier_id = v_user and idempotency_key = p_idempotency_key;
    return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'total', v_existing.total);
  end if;

  perform set_config('app.checkout_order_id', v_order.id::text, true);
  for v_line in select value from jsonb_array_elements(v_items) loop
    insert into public.order_items(order_id, product_id, sku, product_name, unit, quantity, unit_price, line_total)
    values(v_order.id, (v_line ->> 'product_id')::uuid, v_line ->> 'sku', v_line ->> 'product_name', v_line ->> 'unit',
      (v_line ->> 'quantity')::numeric, (v_line ->> 'unit_price')::numeric, (v_line ->> 'line_total')::numeric);
    update public.products set stock = stock - (v_line ->> 'quantity')::numeric where id = (v_line ->> 'product_id')::uuid;
  end loop;
  return jsonb_build_object('order_id', v_order.id, 'order_no', v_order.order_no, 'total', v_order.total);
end $$;
revoke all on function public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text) from public, anon;
grant execute on function public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text) to authenticated;

