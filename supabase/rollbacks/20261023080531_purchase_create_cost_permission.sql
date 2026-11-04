create or replace function public.create_purchase_order(
  p_idempotency_key uuid,
  p_purchased_at timestamp with time zone,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
