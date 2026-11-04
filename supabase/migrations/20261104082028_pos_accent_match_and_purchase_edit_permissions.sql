-- Pending purchase orders can be edited by users who have update permission
-- even when they cannot approve purchases. Editing received orders still
-- requires approval permission because it changes inventory.
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
begin
  if auth.uid() is null or not public.user_has_permission('purchases.update') then
    raise exception 'Không có quyền sửa đơn nhập' using errcode = '42501';
  end if;
  if not public.user_has_permission('products.cost.read') then
    raise exception 'Cần quyền xem giá vốn để sửa đơn nhập' using errcode = '42501';
  end if;

  select po.status into v_status
  from public.purchase_orders po
  where po.id = p_purchase_order_id
  for update;

  if not found or v_status not in ('pending', 'received') then
    raise exception 'Không thể sửa đơn nhập đã hủy hoặc không tồn tại';
  end if;
  if v_status = 'received'
    and not public.user_has_permission('purchases.approve') then
    raise exception 'Không có quyền sửa đơn nhập đã hoàn thành' using errcode = '42501';
  end if;

  return public.update_purchase_order_impl(
    p_purchase_order_id,
    p_purchased_at,
    p_lines
  );
end;
$$;
revoke all on function public.update_purchase_order(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_purchase_order(uuid, timestamptz, jsonb) to authenticated;

-- Keep the existing accent-insensitive search, but rank exact accented matches
-- ahead of fallback matches when the query contains Vietnamese diacritics.
create or replace function public.search_customers(
  p_query text default '',
  p_offset integer default 0,
  p_limit integer default 20,
  p_sort text default 'name',
  p_direction text default 'asc'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with matches as materialized (
    select
      c.id,
      c.name,
      c.phone,
      c.address,
      case
        when extensions.unaccent(
            normalize(lower(trim(coalesce(p_query, ''))), NFC)
          ) <> normalize(lower(trim(coalesce(p_query, ''))), NFC)
          and position(
            normalize(lower(trim(coalesce(p_query, ''))), NFC)
            in normalize(
              lower(coalesce(c.name, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.address, '')),
              NFC
            )
          ) > 0
        then 0
        else 1
      end as accent_rank
    from public.customers c
    where public.search_matches(
      p_query,
      coalesce(c.name, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.address, '')
    )
  ), ranked as (
    select matches.*,
      row_number() over (order by
        accent_rank asc,
        case when p_sort = 'name' and lower(p_direction) <> 'desc' then name end asc,
        case when p_sort = 'name' and lower(p_direction) = 'desc' then name end desc,
        case when p_sort = 'phone' and lower(p_direction) <> 'desc' then phone end asc,
        case when p_sort = 'phone' and lower(p_direction) = 'desc' then phone end desc,
        case when p_sort = 'address' and lower(p_direction) <> 'desc' then address end asc,
        case when p_sort = 'address' and lower(p_direction) = 'desc' then address end desc,
        id asc) as sort_row
    from matches
  ), page as (
    select * from ranked
    order by sort_row
    offset greatest(0, p_offset)
    limit least(100, greatest(1, p_limit))
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(page) - 'sort_row' - 'accent_rank' order by page.sort_row) from page), '[]'::jsonb),
    'total', (select count(*) from matches)
  );
$$;
revoke all on function public.search_customers(text, integer, integer, text, text) from public, anon;
grant execute on function public.search_customers(text, integer, integer, text, text) to authenticated;
