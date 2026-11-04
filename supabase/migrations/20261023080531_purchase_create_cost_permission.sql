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
  v_lines jsonb := p_lines;
  v_can_view_cost boolean := public.user_has_permission('products.cost.read');
  v_can_override_cost boolean :=
    public.user_has_permission('purchases.update')
    and public.user_has_permission('purchases.approve')
    and public.user_has_permission('products.cost.read');
begin
  if auth.uid() is null or not public.user_has_permission('purchases.create') then
    raise exception 'Không có quyền tạo đơn nhập' using errcode = '42501';
  end if;

  if jsonb_typeof(p_lines) = 'array' and not v_can_override_cost then
    select coalesce(
      jsonb_agg(
        case
          when jsonb_typeof(line.value) = 'object' then
            jsonb_set(
              line.value,
              '{unit_cost}',
              to_jsonb(
                case
                  when v_can_view_cost then coalesce(product_cost.cost, 0)
                  else 0::numeric
                end
              ),
              true
            )
          else line.value
        end
        order by line.ordinality
      ),
      '[]'::jsonb
    )
    into v_lines
    from jsonb_array_elements(p_lines) with ordinality as line(value, ordinality)
    left join public.product_costs as product_cost
      on product_cost.product_id = case
        when coalesce(line.value ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (line.value ->> 'product_id')::uuid
        else null
      end;
  end if;

  v_result := public.create_purchase_order_impl(
    p_idempotency_key,
    p_purchased_at,
    v_lines
  );

  if not v_can_view_cost then
    return v_result - 'total';
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_purchase_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.create_purchase_order(uuid, timestamptz, jsonb) to authenticated;
