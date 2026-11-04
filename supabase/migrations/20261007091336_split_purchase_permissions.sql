-- Split the legacy all-in-one permission while preserving existing access.
update public.roles r
set permissions = array(
  select distinct permission
  from unnest(
    array_remove(r.permissions, 'purchases.manage') ||
    array['purchases.read', 'purchases.create', 'purchases.update', 'purchases.delete', 'purchases.approve']::text[]
  ) as granted(permission)
  order by permission
)
where 'purchases.manage' = any(r.permissions);

create or replace function public.user_has_permission(p_permission text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_active and (
      p_permission = any(r.permissions)
      or (p_permission = 'purchases.manage' and r.permissions && array[
        'purchases.read', 'purchases.create', 'purchases.update', 'purchases.delete', 'purchases.approve'
      ]::text[])
    )
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = (select auth.uid())), false)
$$;
revoke all on function public.user_has_permission(text) from public, anon;
grant execute on function public.user_has_permission(text) to authenticated;

drop policy if exists purchase_orders_read on public.purchase_orders;
create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using (
    public.user_has_permission('products.cost.read')
    and (
      public.user_has_permission('purchases.read')
      or public.user_has_permission('purchases.update')
      or public.user_has_permission('purchases.delete')
      or public.user_has_permission('purchases.approve')
    )
  );

drop policy if exists purchase_order_items_read on public.purchase_order_items;
create policy purchase_order_items_read on public.purchase_order_items for select to authenticated
  using (
    public.user_has_permission('products.cost.read')
    and (public.user_has_permission('purchases.read') or public.user_has_permission('purchases.update'))
    and exists (select 1 from public.purchase_orders po where po.id = purchase_order_id)
  );

drop policy if exists products_read_for_purchasing on public.products;
create policy products_read_for_purchasing on public.products for select to authenticated
  using (
    is_active
    and (public.user_has_permission('purchases.create') or public.user_has_permission('purchases.update'))
  );

create or replace function public.get_purchase_orders()
returns table(id uuid, purchase_no text, purchased_at timestamptz, received_at timestamptz, status text, total numeric)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    public.user_has_permission('purchases.read')
    or public.user_has_permission('purchases.update')
    or public.user_has_permission('purchases.delete')
    or public.user_has_permission('purchases.approve')
  ) then
    raise exception 'Không có quyền xem danh sách đơn nhập' using errcode = '42501';
  end if;
  return query
    select po.id, po.purchase_no, po.purchased_at, po.received_at, po.status,
      case when public.user_has_permission('products.cost.read') then po.total else null end
    from public.purchase_orders po
    order by po.purchased_at desc
    limit 200;
end;
$$;
revoke all on function public.get_purchase_orders() from public, anon;
grant execute on function public.get_purchase_orders() to authenticated;

create or replace function public.get_purchase_order_items(p_purchase_order_id uuid)
returns table(id uuid, sku text, product_name text, unit text, quantity numeric, unit_cost numeric, line_total numeric)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('purchases.read') then
    raise exception 'Không có quyền xem chi tiết đơn nhập' using errcode = '42501';
  end if;
  return query
    select poi.id, poi.sku, poi.product_name, poi.unit, poi.quantity,
      case when public.user_has_permission('products.cost.read') then poi.unit_cost else null end,
      case when public.user_has_permission('products.cost.read') then poi.line_total else null end
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    where po.id = p_purchase_order_id;
end;
$$;
revoke all on function public.get_purchase_order_items(uuid) from public, anon;
grant execute on function public.get_purchase_order_items(uuid) to authenticated;

-- Keep the existing transactional implementations private and expose narrow
-- permission-checked RPC entry points for each purchase action.
alter function public.create_purchase_order(uuid, timestamptz, jsonb) rename to create_purchase_order_impl;
revoke all on function public.create_purchase_order_impl(uuid, timestamptz, jsonb) from public, anon, authenticated;
create function public.create_purchase_order(p_idempotency_key uuid, p_purchased_at timestamptz, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.user_has_permission('purchases.create') then
    raise exception 'Không có quyền tạo đơn nhập' using errcode = '42501';
  end if;
  v_result := public.create_purchase_order_impl(p_idempotency_key, p_purchased_at, p_lines);
  if not public.user_has_permission('products.cost.read') then
    return v_result - 'total';
  end if;
  return v_result;
end;
$$;
revoke all on function public.create_purchase_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.create_purchase_order(uuid, timestamptz, jsonb) to authenticated;

alter function public.update_purchase_order(uuid, timestamptz, jsonb) rename to update_purchase_order_impl;
revoke all on function public.update_purchase_order_impl(uuid, timestamptz, jsonb) from public, anon, authenticated;
create function public.update_purchase_order(p_purchase_order_id uuid, p_purchased_at timestamptz, p_lines jsonb)
returns numeric language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('purchases.update') then
    raise exception 'Không có quyền sửa đơn nhập' using errcode = '42501';
  end if;
  if not public.user_has_permission('products.cost.read') then
    raise exception 'Cần quyền xem giá vốn để sửa đơn nhập' using errcode = '42501';
  end if;
  return public.update_purchase_order_impl(p_purchase_order_id, p_purchased_at, p_lines);
end;
$$;
revoke all on function public.update_purchase_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_purchase_order(uuid, timestamptz, jsonb) to authenticated;

alter function public.update_pending_purchase_order(uuid, timestamptz, jsonb) rename to update_pending_purchase_order_impl;
revoke all on function public.update_pending_purchase_order_impl(uuid, timestamptz, jsonb) from public, anon, authenticated;
create function public.update_pending_purchase_order(p_purchase_order_id uuid, p_purchased_at timestamptz, p_lines jsonb)
returns numeric language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('purchases.update') then
    raise exception 'Không có quyền sửa đơn nhập' using errcode = '42501';
  end if;
  if not public.user_has_permission('products.cost.read') then
    raise exception 'Cần quyền xem giá vốn để sửa đơn nhập' using errcode = '42501';
  end if;
  return public.update_pending_purchase_order_impl(p_purchase_order_id, p_purchased_at, p_lines);
end;
$$;
revoke all on function public.update_pending_purchase_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_pending_purchase_order(uuid, timestamptz, jsonb) to authenticated;

alter function public.delete_purchase_order(uuid) rename to delete_purchase_order_impl;
revoke all on function public.delete_purchase_order_impl(uuid) from public, anon, authenticated;
create function public.delete_purchase_order(p_purchase_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('purchases.delete') then
    raise exception 'Không có quyền xóa đơn nhập' using errcode = '42501';
  end if;
  perform public.delete_purchase_order_impl(p_purchase_order_id);
end;
$$;
revoke all on function public.delete_purchase_order(uuid) from public, anon;
grant execute on function public.delete_purchase_order(uuid) to authenticated;

alter function public.delete_pending_purchase_order(uuid) rename to delete_pending_purchase_order_impl;
revoke all on function public.delete_pending_purchase_order_impl(uuid) from public, anon, authenticated;
create function public.delete_pending_purchase_order(p_purchase_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('purchases.delete') then
    raise exception 'Không có quyền xóa đơn nhập' using errcode = '42501';
  end if;
  perform public.delete_pending_purchase_order_impl(p_purchase_order_id);
end;
$$;
revoke all on function public.delete_pending_purchase_order(uuid) from public, anon;
grant execute on function public.delete_pending_purchase_order(uuid) to authenticated;

alter function public.receive_purchase_order(uuid) rename to receive_purchase_order_impl;
revoke all on function public.receive_purchase_order_impl(uuid) from public, anon, authenticated;
create function public.receive_purchase_order(p_purchase_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('purchases.approve') then
    raise exception 'Không có quyền duyệt đơn nhập' using errcode = '42501';
  end if;
  if not public.user_has_permission('products.cost.read') then
    raise exception 'Cần quyền xem giá vốn để duyệt đơn nhập' using errcode = '42501';
  end if;
  perform public.receive_purchase_order_impl(p_purchase_order_id);
end;
$$;
revoke all on function public.receive_purchase_order(uuid) from public, anon;
grant execute on function public.receive_purchase_order(uuid) to authenticated;
