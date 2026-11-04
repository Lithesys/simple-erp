-- Return a stable server-side page while keeping totals across all matches.
drop function public.get_purchase_orders(date, date, text, text, text, text, text[]);
create function public.get_purchase_orders(
  p_from date,
  p_to date,
  p_sort text default 'purchased_at',
  p_direction text default 'desc',
  p_query text default '',
  p_product_query text default '',
  p_statuses text[] default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sort text := case when p_sort in ('purchase_no', 'purchased_at', 'total', 'status') then p_sort else 'purchased_at' end;
  v_direction text := case when lower(p_direction) = 'asc' then 'asc' else 'desc' end;
  v_can_view_cost boolean := public.user_has_permission('products.cost.read');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if auth.uid() is null or not (
    public.user_has_permission('purchases.read') or
    public.user_has_permission('purchases.update') or
    public.user_has_permission('purchases.delete') or
    public.user_has_permission('purchases.approve')
  ) then
    raise exception 'Không có quyền xem danh sách đơn nhập' using errcode = '42501';
  end if;
  if v_sort = 'total' and not v_can_view_cost then
    v_sort := 'purchased_at';
  end if;

  with matches as materialized (
    select po.id, po.purchase_no, po.purchased_at, po.created_at, po.received_at,
      po.status,
      case when v_can_view_cost then po.total else null end as total,
      coalesce(items.product_search, '') as product_search,
      po.total as sort_total
    from public.purchase_orders po
    left join lateral (
      select string_agg(poi.sku || ' ' || poi.product_name, ' ') as product_search
      from public.purchase_order_items poi where poi.purchase_order_id = po.id
    ) items on true
    where (p_from is null or po.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_to is null or po.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (coalesce(array_length(p_statuses, 1), 0) = 0 or po.status = any(p_statuses))
      and public.search_matches(p_query, po.purchase_no)
      and public.search_matches(p_product_query, coalesce(items.product_search, ''))
  ), ranked as (
    select matches.*,
      row_number() over (order by
        case when v_sort = 'purchase_no' and v_direction = 'asc' then purchase_no end asc,
        case when v_sort = 'purchase_no' and v_direction = 'desc' then purchase_no end desc,
        case when v_sort = 'purchased_at' and v_direction = 'asc' then purchased_at end asc,
        case when v_sort = 'purchased_at' and v_direction = 'desc' then purchased_at end desc,
        case when v_sort = 'total' and v_direction = 'asc' then sort_total end asc,
        case when v_sort = 'total' and v_direction = 'desc' then sort_total end desc,
        case when v_sort = 'status' and v_direction = 'asc' then status end asc,
        case when v_sort = 'status' and v_direction = 'desc' then status end desc,
        id asc) as sort_row
    from matches
  ), page as (
    select * from ranked
    order by sort_row
    offset v_offset
    limit v_limit
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(page) - array['sort_total', 'sort_row'] order by page.sort_row) from page), '[]'::jsonb),
    'total', (select count(*) from matches),
    'payable_total', case when v_can_view_cost then coalesce((select sum(sort_total) from matches), 0) else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_purchase_orders(date, date, text, text, text, text, text[], integer, integer) from public, anon;
grant execute on function public.get_purchase_orders(date, date, text, text, text, text, text[], integer, integer) to authenticated;
