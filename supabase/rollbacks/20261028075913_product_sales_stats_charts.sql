-- Restore the function contract and raw completed-order aggregation that
-- existed before product sales trend charts were added.
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
