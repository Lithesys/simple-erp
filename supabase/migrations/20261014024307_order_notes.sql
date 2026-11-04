alter table public.orders
  add column if not exists note text not null default '';

create or replace function public.checkout_order(
  p_idempotency_key uuid,
  p_price_list_id uuid,
  p_customer_name text,
  p_discount numeric,
  p_lines jsonb,
  p_customer_phone text,
  p_customer_address text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
  v_order_id uuid;
begin
  if v_user is null then
    raise exception 'Không có phiên đăng nhập' using errcode = '42501';
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'Ghi chú đơn hàng quá dài';
  end if;

  v_result := public.checkout_order(
    p_idempotency_key,
    p_price_list_id,
    p_customer_name,
    p_discount,
    p_lines,
    p_customer_phone,
    p_customer_address
  );
  v_order_id := nullif(v_result ->> 'order_id', '')::uuid;

  update public.orders
  set note = trim(coalesce(p_note, ''))
  where id = v_order_id
    and cashier_id = v_user;

  if not found then
    raise exception 'Không thể lưu ghi chú đơn hàng' using errcode = '42501';
  end if;

  return v_result;
end;
$$;

revoke all on function public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text, text) from public, anon;
grant execute on function public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text, text) to authenticated;
