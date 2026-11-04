create extension if not exists pgcrypto;
create schema if not exists private;

create sequence if not exists public.order_number_seq;

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.roles(name, description, permissions, is_system) values
('Admin', 'Quản trị toàn bộ cửa hàng', array['sales.create','orders.read_own','orders.read_all','products.read','products.create','products.update','products.archive','products.cost.read','price_lists.manage','accounts.manage','roles.manage'], true),
('Nhân viên', 'Bán hàng và xem đơn của mình', array['sales.create','orders.read_own','products.read'], true)
on conflict (name) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role_id uuid not null references public.roles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.price_lists(name, is_default) values ('Giá bán lẻ', true) on conflict (name) do nothing;
create unique index one_default_price_list on public.price_lists(is_default) where is_default;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  unit text not null default 'cái',
  stock numeric(14,3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create sequence if not exists public.product_sku_seq;
alter table public.products alter column sku set default ('LDL-' || lpad(nextval('public.product_sku_seq')::text, 6, '0'));

create table public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost numeric(14,2) not null default 0 check (cost >= 0),
  updated_at timestamptz not null default now()
);
create or replace function public.seed_product_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.product_costs(product_id, cost) values (new.id, 0); return new; end $$;
create trigger seed_product_cost_after_product_insert after insert on public.products for each row execute function public.seed_product_cost();
revoke all on function public.seed_product_cost() from public, anon, authenticated;

create table public.product_prices (
  product_id uuid not null references public.products(id) on delete cascade,
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  price numeric(14,2) not null default 0 check (price >= 0),
  updated_at timestamptz not null default now(),
  primary key(product_id, price_list_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique default ('LDL-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 6, '0')),
  idempotency_key uuid not null,
  cashier_id uuid references auth.users(id) on delete set null,
  price_list_id uuid references public.price_lists(id) on delete set null,
  price_list_name text not null,
  customer_name text not null default 'Khách lẻ',
  subtotal numeric(14,0) not null check (subtotal >= 0),
  discount numeric(14,0) not null check (discount >= 0 and discount <= subtotal),
  total numeric(14,0) not null check (total = subtotal - discount),
  status text not null default 'completed' check (status = 'completed'),
  created_at timestamptz not null default now(),
  unique(cashier_id, idempotency_key)
);
create index orders_created_at_idx on public.orders(created_at desc);
create index orders_customer_idx on public.orders using gin(to_tsvector('simple', customer_name));

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  product_name text not null,
  unit text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,0) not null check (line_total >= 0)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  quantity_change numeric(14,3) not null,
  reason text not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.record_stock_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order_id uuid; v_reason text;
begin
  if new.stock is distinct from old.stock then
    v_order_id := nullif(current_setting('app.checkout_order_id', true), '')::uuid;
    v_reason := case when v_order_id is null then 'Điều chỉnh tồn kho' else 'Bán hàng' end;
    insert into public.inventory_movements(product_id, order_id, quantity_change, reason, actor_id)
    values (new.id, v_order_id, new.stock - old.stock, v_reason, auth.uid());
  end if;
  return new;
end $$;
create trigger record_stock_change_after_update after update of stock on public.products for each row execute function public.record_stock_change();
revoke all on function public.record_stock_change() from public, anon, authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

create or replace function public.protect_product_archive()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.is_active is distinct from new.is_active and not public.user_has_permission('products.archive') then
    raise exception 'Không có quyền ngừng kinh doanh hàng hóa' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger protect_product_archive_update before update of is_active on public.products for each row execute function public.protect_product_archive();

create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() = old.id and (new.role_id is distinct from old.role_id or new.is_active is distinct from old.is_active) then
    raise exception 'Không thể tự đổi quyền hoặc trạng thái tài khoản' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger protect_profile_role before update on public.profiles for each row execute function public.protect_profile_role();

create or replace function public.protect_last_admin_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old_is_admin boolean; v_new_is_admin boolean; v_remaining integer;
begin
  perform pg_advisory_xact_lock(hashtext('lan-duy-linh-last-admin'));
  select 'accounts.manage' = any(permissions) into v_old_is_admin from public.roles where id = old.role_id;
  if tg_op = 'DELETE' then v_new_is_admin := false;
  else select new.is_active and 'accounts.manage' = any(permissions) into v_new_is_admin from public.roles where id = new.role_id;
  end if;
  if v_old_is_admin and not coalesce(v_new_is_admin, false) and old.is_active then
    select count(*) into v_remaining from public.profiles p join public.roles r on r.id=p.role_id
      where p.id <> old.id and p.is_active and 'accounts.manage' = any(r.permissions);
    if v_remaining = 0 then raise exception 'Không thể loại bỏ quản trị viên hoạt động cuối cùng' using errcode = '23514'; end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
create trigger preserve_last_admin_profile before update or delete on public.profiles for each row execute function public.protect_last_admin_profile();
revoke all on function public.protect_last_admin_profile() from public, anon, authenticated;

create or replace function public.protect_last_admin_role()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_remaining integer; v_old_is_admin boolean; v_new_is_admin boolean;
begin
  perform pg_advisory_xact_lock(hashtext('lan-duy-linh-last-admin'));
  v_old_is_admin := 'accounts.manage' = any(old.permissions);
  if tg_op = 'DELETE' then v_new_is_admin := false;
  else v_new_is_admin := 'accounts.manage' = any(new.permissions);
  end if;
  if v_old_is_admin and not coalesce(v_new_is_admin, false) then
    select count(*) into v_remaining from public.profiles p join public.roles r on r.id=p.role_id
      where p.is_active and p.role_id <> old.id and 'accounts.manage' = any(r.permissions);
    if exists(select 1 from public.profiles where role_id=old.id and is_active) and v_remaining = 0 then
      raise exception 'Không thể loại bỏ vai trò của quản trị viên hoạt động cuối cùng' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
create trigger preserve_last_admin_role before update or delete on public.roles for each row execute function public.protect_last_admin_role();
revoke all on function public.protect_last_admin_role() from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role uuid;
begin
  if new.raw_app_meta_data ->> 'erp_managed' is distinct from 'true' then return new; end if;
  select id into v_role from public.roles where name = 'Nhân viên' limit 1;
  insert into public.profiles(id, display_name, role_id)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), v_role)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.protect_profile_role() from public, anon, authenticated;

create or replace function public.current_user_access()
returns table(display_name text, role_name text, permissions text[], is_active boolean)
language sql stable security definer set search_path = '' as $$
  select p.display_name, r.name, r.permissions, p.is_active
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = (select auth.uid())
$$;

create or replace function public.user_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_active and (p_permission = any(r.permissions))
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = (select auth.uid())), false)
$$;
revoke all on function public.current_user_access() from public, anon;
revoke all on function public.user_has_permission(text) from public, anon;
grant execute on function public.current_user_access() to authenticated;
grant execute on function public.user_has_permission(text) to authenticated;

create or replace function public.checkout_order(
  p_idempotency_key uuid,
  p_price_list_id uuid,
  p_customer_name text,
  p_discount numeric,
  p_lines jsonb
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

  insert into public.orders(idempotency_key, cashier_id, price_list_id, price_list_name, customer_name, subtotal, discount, total)
  values (p_idempotency_key, v_user, v_list.id, v_list.name, v_name, v_subtotal, v_discount, v_total)
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
revoke all on function public.checkout_order(uuid, uuid, text, numeric, jsonb) from public, anon;
grant execute on function public.checkout_order(uuid, uuid, text, numeric, jsonb) to authenticated;

create or replace function public.set_default_price_list(p_price_list_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.user_has_permission('price_lists.manage') then raise exception 'Không có quyền quản lý bảng giá' using errcode = '42501'; end if;
  if not exists(select 1 from public.price_lists where id=p_price_list_id and is_active) then raise exception 'Bảng giá không tồn tại hoặc đã ngừng hoạt động'; end if;
  update public.price_lists set is_default=false where is_default;
  update public.price_lists set is_default=true where id=p_price_list_id;
end $$;
revoke all on function public.set_default_price_list(uuid) from public, anon;
grant execute on function public.set_default_price_list(uuid) to authenticated;

create or replace function public.archive_product(p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.user_has_permission('products.archive') then raise exception 'Không có quyền ngừng kinh doanh hàng hóa' using errcode = '42501'; end if;
  update public.products set is_active=false where id=p_product_id;
  if not found then raise exception 'Không tìm thấy hàng hóa'; end if;
end $$;
revoke all on function public.archive_product(uuid) from public, anon;
grant execute on function public.archive_product(uuid) to authenticated;

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.price_lists enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.product_prices enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory_movements enable row level security;

create policy "roles view by managers" on public.roles for select to authenticated using (public.user_has_permission('roles.manage') or public.user_has_permission('accounts.manage'));
create policy "role managers manage roles" on public.roles for all to authenticated using (public.user_has_permission('roles.manage') and not is_system) with check (public.user_has_permission('roles.manage') and not is_system);
create policy "own profile or account managers can view" on public.profiles for select to authenticated using (id = (select auth.uid()) or public.user_has_permission('accounts.manage'));
create policy "own profile can update self name" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "read active price lists" on public.price_lists for select to authenticated using ((is_active and (public.user_has_permission('sales.create') or public.user_has_permission('products.read'))) or public.user_has_permission('price_lists.manage'));
create policy "manage price lists" on public.price_lists for all to authenticated using (public.user_has_permission('price_lists.manage')) with check (public.user_has_permission('price_lists.manage'));
create policy "read active products" on public.products for select to authenticated using ((is_active and (public.user_has_permission('products.read') or public.user_has_permission('sales.create'))) or public.user_has_permission('products.update'));
create policy "insert products" on public.products for insert to authenticated with check (public.user_has_permission('products.create'));
create policy "update products" on public.products for update to authenticated using (public.user_has_permission('products.update')) with check (public.user_has_permission('products.update'));
create policy "read costs with permission" on public.product_costs for select to authenticated using (public.user_has_permission('products.cost.read'));
create policy "insert costs" on public.product_costs for insert to authenticated with check (public.user_has_permission('products.update'));
create policy "update costs" on public.product_costs for update to authenticated using (public.user_has_permission('products.update')) with check (public.user_has_permission('products.update'));
create policy "read active prices" on public.product_prices for select to authenticated using ((exists(select 1 from public.price_lists l where l.id=price_list_id and l.is_active) and (public.user_has_permission('sales.create') or public.user_has_permission('products.read') or public.user_has_permission('products.update'))) or public.user_has_permission('price_lists.manage'));
create policy "insert prices" on public.product_prices for insert to authenticated with check (public.user_has_permission('products.create') or public.user_has_permission('products.update') or public.user_has_permission('price_lists.manage'));
create policy "update prices" on public.product_prices for update to authenticated using (public.user_has_permission('products.update') or public.user_has_permission('price_lists.manage')) with check (public.user_has_permission('products.update') or public.user_has_permission('price_lists.manage'));
create policy "view own orders or all" on public.orders for select to authenticated using (cashier_id = (select auth.uid()) and public.user_has_permission('orders.read_own') or public.user_has_permission('orders.read_all'));
create policy "view order items by order permission" on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and (o.cashier_id=(select auth.uid()) and public.user_has_permission('orders.read_own') or public.user_has_permission('orders.read_all'))));
create policy "view inventory history" on public.inventory_movements for select to authenticated using (public.user_has_permission('products.update'));

grant usage on schema public to authenticated;
grant select on public.roles, public.profiles, public.price_lists, public.products, public.product_costs, public.product_prices, public.orders, public.order_items, public.inventory_movements to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert, update on public.price_lists, public.products, public.product_costs, public.product_prices to authenticated;
grant insert, update, delete on public.roles to authenticated;
