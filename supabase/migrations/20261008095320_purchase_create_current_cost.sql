-- Quantity-only purchase creators cannot read or edit costs, but new purchase
-- lines should still snapshot the current product cost on the server.
create or replace function public.guard_purchase_cost_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.user_has_permission('products.cost.read') then
    if tg_op = 'INSERT' then
      select pc.cost
      into new.unit_cost
      from public.product_costs pc
      where pc.product_id = new.product_id
      for share;
      if not found then
        new.unit_cost := 0;
      end if;
      new.line_total := round(new.quantity * new.unit_cost);
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

create or replace function public.guard_purchase_order_cost_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.user_has_permission('products.cost.read') then
    if tg_op = 'INSERT' then
      new.total := 0;
    else
      if new.status = 'received' and old.status is distinct from 'received' then
        raise exception 'Cần quyền xem giá vốn để duyệt đơn nhập' using errcode = '42501';
      end if;
      new.total := coalesce((
        select sum(poi.line_total)
        from public.purchase_order_items poi
        where poi.purchase_order_id = new.id
      ), 0);
    end if;
  end if;
  return new;
end;
$$;
