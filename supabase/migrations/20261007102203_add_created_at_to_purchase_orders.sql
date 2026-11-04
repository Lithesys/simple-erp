-- Let the purchase list filter by when the record was created, independently
-- from purchased_at and received_at.
create index if not exists purchase_orders_created_at_idx
  on public.purchase_orders(created_at desc);

-- Keep the existing no-argument RPC available for older clients.
create function public.get_purchase_orders(p_from date, p_to date)
returns table(
  id uuid,
  purchase_no text,
  purchased_at timestamptz,
  created_at timestamptz,
  received_at timestamptz,
  status text,
  total numeric,
  product_search text
)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    public.user_has_permission('purchases.read') or
    public.user_has_permission('purchases.update') or
    public.user_has_permission('purchases.delete') or
    public.user_has_permission('purchases.approve')
  ) then
    raise exception 'Không có quyền xem danh sách đơn nhập' using errcode = '42501';
  end if;

  return query
    select po.id, po.purchase_no, po.purchased_at, po.created_at, po.received_at, po.status,
      case when public.user_has_permission('products.cost.read') then po.total else null end,
      coalesce(items.product_search, '')
    from public.purchase_orders po
    left join lateral (
      select string_agg(poi.sku || ' ' || poi.product_name, ' ') as product_search
      from public.purchase_order_items poi where poi.purchase_order_id = po.id
    ) items on true
    where (p_from is null or po.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_to is null or po.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
    order by po.purchased_at desc
    limit case when p_from is null and p_to is null then 200 else null end;
end;
$$;

revoke all on function public.get_purchase_orders(date, date) from public, anon;
grant execute on function public.get_purchase_orders(date, date) to authenticated;
