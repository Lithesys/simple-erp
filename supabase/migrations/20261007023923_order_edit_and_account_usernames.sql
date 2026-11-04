alter table public.profiles add column username text;
update public.profiles p
set username = 'user_' || replace(substr(p.id::text, 1, 13), '-', '');
alter table public.profiles alter column username set not null;
create unique index profiles_username_lower_uidx on public.profiles (lower(username));
alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-zA-Z0-9._-]{3,32}$');

update public.roles
set permissions = array(select distinct permission from unnest(permissions || array['orders.edit']) as permission order by permission)
where name = 'Admin';

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
    raise exception 'Đơn hàng cần có ít nhất một sản phẩm';
  end if;
  if p_discount is null or p_discount < 0 then raise exception 'Giảm giá không hợp lệ'; end if;
  if coalesce(trim(p_customer_name), '') = '' or length(p_customer_name) > 300
     or length(coalesce(p_customer_phone, '')) > 100 or length(coalesce(p_customer_address, '')) > 1000 then
    raise exception 'Thông tin khách hàng không hợp lệ';
  end if;

  select * into v_order from public.orders where id = p_order_id and status = 'completed' for update;
  if not found then raise exception 'Không tìm thấy đơn hàng'; end if;

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
