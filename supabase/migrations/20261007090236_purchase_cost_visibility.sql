drop policy if exists "purchasing users can read current product costs" on public.product_costs;

drop policy if exists purchase_orders_read on public.purchase_orders;
create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using (public.user_has_permission('purchases.manage') and public.user_has_permission('products.cost.read'));

create or replace function public.get_purchase_orders()
returns table(id uuid, purchase_no text, purchased_at timestamptz, received_at timestamptz, status text, total numeric)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền xem đơn nhập hàng' using errcode = '42501';
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

drop policy if exists purchase_order_items_read on public.purchase_order_items;
create policy purchase_order_items_read on public.purchase_order_items for select to authenticated
  using (
    public.user_has_permission('purchases.manage')
    and public.user_has_permission('products.cost.read')
    and exists (select 1 from public.purchase_orders po where po.id = purchase_order_id)
  );

create or replace function public.get_purchase_order_items(p_purchase_order_id uuid)
returns table(id uuid, sku text, product_name text, unit text, quantity numeric, unit_cost numeric, line_total numeric)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền xem đơn nhập hàng' using errcode = '42501';
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

create or replace function public.guard_purchase_cost_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.user_has_permission('products.cost.read') then
    if tg_op = 'INSERT' then
      new.unit_cost := 0;
      new.line_total := 0;
    else
      if new.unit_cost is distinct from old.unit_cost then
        raise exception 'Cần quyền xem giá vốn để chỉnh sửa giá hàng' using errcode = '42501';
      end if;
      new.line_total := round(new.quantity * old.unit_cost);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_purchase_cost_changes() from public, anon, authenticated;
create trigger guard_purchase_cost_changes
before insert or update of unit_cost, line_total, quantity on public.purchase_order_items
for each row execute function public.guard_purchase_cost_changes();

create or replace function public.guard_purchase_order_cost_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.user_has_permission('products.cost.read') then
    if tg_op = 'INSERT' then
      new.total := 0;
    else
      if new.total is distinct from old.total then
        raise exception 'Cần quyền xem giá vốn để thay đổi tổng tiền nhập' using errcode = '42501';
      end if;
      if new.status = 'received' and old.status is distinct from 'received' then
        raise exception 'Cần quyền xem giá vốn để duyệt đơn nhập' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_purchase_order_cost_access() from public, anon, authenticated;
create trigger guard_purchase_order_cost_access
before insert or update of total, status on public.purchase_orders
for each row execute function public.guard_purchase_order_cost_access();
