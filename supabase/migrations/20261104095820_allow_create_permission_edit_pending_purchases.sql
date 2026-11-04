-- Users who can create purchase orders may correct them while they are still
-- pending. Received orders continue to require update, approval, and cost-read
-- permissions because changes affect inventory and purchase prices.
create or replace function public.update_purchase_order(
  p_purchase_order_id uuid,
  p_purchased_at timestamptz,
  p_lines jsonb
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_can_update boolean := public.user_has_permission('purchases.update');
  v_can_create boolean := public.user_has_permission('purchases.create');
  v_can_view_cost boolean := public.user_has_permission('products.cost.read');
  v_lines jsonb := p_lines;
  v_total numeric;
begin
  if auth.uid() is null then
    raise exception 'Cần đăng nhập để sửa đơn nhập' using errcode = '42501';
  end if;

  select po.status into v_status
  from public.purchase_orders po
  where po.id = p_purchase_order_id
  for update;

  if not found or v_status not in ('pending', 'received') then
    raise exception 'Không thể sửa đơn nhập đã hủy hoặc không tồn tại';
  end if;

  if v_status = 'pending' then
    if not (v_can_create or (v_can_update and v_can_view_cost)) then
      raise exception 'Cần quyền tạo hoặc sửa đơn nhập để cập nhật phiếu chưa duyệt'
        using errcode = '42501';
    end if;
  elsif not (
    v_can_update
    and public.user_has_permission('purchases.approve')
    and v_can_view_cost
  ) then
    raise exception 'Không có quyền sửa đơn nhập đã hoàn thành'
      using errcode = '42501';
  end if;

  if not v_can_view_cost and jsonb_typeof(p_lines) = 'array' then
    -- Do not expose or replace existing costs for create-only users. New lines
    -- follow the existing create flow and start with a zero cost.
    select coalesce(
      jsonb_agg(
        case
          when jsonb_typeof(line.value) = 'object' then
            jsonb_set(
              line.value,
              '{unit_cost}',
              to_jsonb(coalesce(existing_item.unit_cost, 0::numeric)),
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
    left join public.purchase_order_items existing_item
      on existing_item.purchase_order_id = p_purchase_order_id
      and existing_item.id = case
        when coalesce(line.value ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (line.value ->> 'id')::uuid
        else null
      end;
  end if;

  v_total := public.update_purchase_order_impl(
    p_purchase_order_id,
    p_purchased_at,
    v_lines
  );

  if not v_can_view_cost then
    return null;
  end if;
  return v_total;
end;
$$;
revoke all on function public.update_purchase_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_purchase_order(uuid, timestamptz, jsonb) to authenticated;

create or replace function public.get_purchase_order_edit_items(
  p_purchase_order_id uuid
)
returns table(
  id uuid,
  product_id uuid,
  quantity numeric,
  unit_cost numeric,
  sku text,
  product_name text,
  unit text,
  line_total numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_can_view_cost boolean := public.user_has_permission('products.cost.read');
begin
  if auth.uid() is null then
    raise exception 'Cần đăng nhập để xem đơn nhập' using errcode = '42501';
  end if;

  select po.status into v_status
  from public.purchase_orders po
  where po.id = p_purchase_order_id;

  if not found or v_status not in ('pending', 'received') then
    raise exception 'Không thể sửa đơn nhập đã hủy hoặc không tồn tại';
  end if;

  if v_status = 'pending' then
    if not (
      public.user_has_permission('purchases.create')
      or (public.user_has_permission('purchases.update') and v_can_view_cost)
    ) then
      raise exception 'Cần quyền tạo hoặc sửa đơn nhập để xem phiếu chưa duyệt'
        using errcode = '42501';
    end if;
  elsif not (
    public.user_has_permission('purchases.update')
    and public.user_has_permission('purchases.approve')
    and v_can_view_cost
  ) then
    raise exception 'Không có quyền xem đơn nhập đã hoàn thành'
      using errcode = '42501';
  end if;

  return query
    select
      item.id,
      item.product_id,
      item.quantity,
      case when v_can_view_cost then item.unit_cost else null::numeric end,
      item.sku,
      item.product_name,
      item.unit,
      case when v_can_view_cost then item.line_total else null::numeric end
    from public.purchase_order_items item
    where item.purchase_order_id = p_purchase_order_id
    order by item.id;
end;
$$;
revoke all on function public.get_purchase_order_edit_items(uuid) from public, anon;
grant execute on function public.get_purchase_order_edit_items(uuid) to authenticated;
