-- Reversing a received purchase can take stock below zero when some of the
-- received units have already been sold or otherwise consumed. Keep the stock
-- movement so the balance and inventory history remain consistent.
create or replace function public.delete_purchase_order_impl(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_item record;
begin
  if auth.uid() is null or not public.user_has_permission('purchases.manage') then
    raise exception 'Không có quyền xóa đơn nhập' using errcode = '42501';
  end if;

  select * into v_order
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found or v_order.status not in ('pending', 'received') then
    raise exception 'Đơn nhập đã hủy hoặc không tồn tại';
  end if;

  if v_order.status = 'received' then
    perform p.id
    from public.products p
    where p.id in (
      select poi.product_id from public.purchase_order_items poi
      where poi.purchase_order_id = p_purchase_order_id and poi.product_id is not null
    )
    order by p.id
    for update;

    perform set_config('app.purchase_order_id', p_purchase_order_id::text, true);
    perform set_config('app.inventory_reason', 'Hủy đơn nhập', true);

    for v_item in
      select poi.product_id, sum(poi.quantity) as quantity
      from public.purchase_order_items poi
      where poi.purchase_order_id = p_purchase_order_id and poi.product_id is not null
      group by poi.product_id
      order by poi.product_id
    loop
      -- Intentionally allow a negative balance: these units may already have
      -- been consumed, and refusing cancellation would leave the purchase in
      -- the ledger after the user has asked to reverse it.
      update public.products p
      set stock = p.stock - v_item.quantity
      where p.id = v_item.product_id;
      if not found then
        raise exception 'Không tìm thấy mặt hàng trong đơn nhập';
      end if;
    end loop;
  end if;

  -- Keep the order and its line snapshots for audit; cancelled orders are hidden by default in the UI.
  update public.purchase_orders
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_purchase_order_id;
end;
$$;

revoke all on function public.delete_purchase_order_impl(uuid) from public, anon, authenticated;
