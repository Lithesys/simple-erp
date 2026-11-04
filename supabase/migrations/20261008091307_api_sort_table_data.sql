-- Sort customer pages in Postgres and keep the result count for the full search.
drop function public.search_customers(text, integer, integer);
create function public.search_customers(
  p_query text default '',
  p_offset integer default 0,
  p_limit integer default 20,
  p_sort text default 'name',
  p_direction text default 'asc'
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as materialized (
    select id, name, phone, address
    from public.customers
    where position(lower(trim(coalesce(p_query, ''))) in lower(name || ' ' || phone || ' ' || address)) > 0
  ), ranked as (
    select matches.*,
      row_number() over (order by
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
    'rows', coalesce((select jsonb_agg(to_jsonb(page) - 'sort_row' order by page.sort_row) from page), '[]'::jsonb),
    'total', (select count(*) from matches)
  );
$$;
revoke all on function public.search_customers(text, integer, integer, text, text) from public, anon;
grant execute on function public.search_customers(text, integer, integer, text, text) to authenticated;

-- Return purchase rows already filtered and sorted, plus full-result totals.
drop function public.get_purchase_orders(date, date);
create function public.get_purchase_orders(
  p_from date,
  p_to date,
  p_sort text default 'purchased_at',
  p_direction text default 'desc',
  p_query text default '',
  p_product_query text default '',
  p_statuses text[] default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sort text := case when p_sort in ('purchase_no', 'purchased_at', 'total', 'status') then p_sort else 'purchased_at' end;
  v_direction text := case when lower(p_direction) = 'asc' then 'asc' else 'desc' end;
  v_can_view_cost boolean := public.user_has_permission('products.cost.read');
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
      and (position(lower(trim(coalesce(p_query, ''))) in lower(po.purchase_no)) > 0)
      and (position(lower(trim(coalesce(p_product_query, ''))) in lower(coalesce(items.product_search, ''))) > 0)
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
    where p_from is not null or p_to is not null or sort_row <= 200
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(page) - array['sort_total', 'sort_row'] order by page.sort_row) from page), '[]'::jsonb),
    'total', (select count(*) from matches),
    'payable_total', case when v_can_view_cost then coalesce((select sum(sort_total) from matches), 0) else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_purchase_orders(date, date, text, text, text, text, text[]) from public, anon;
grant execute on function public.get_purchase_orders(date, date, text, text, text, text, text[]) to authenticated;

-- Keep every orders footer aggregate in the filtered API query, including profit.
create or replace function public.orders_summary_filtered(
  p_invoice_query text default '',
  p_customer_query text default '',
  p_product_skus text[] default '{}',
  p_statuses text[] default array['completed']::text[],
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*),
    'subtotal', coalesce(sum(o.subtotal), 0),
    'discount', coalesce(sum(o.discount), 0),
    'total', coalesce(sum(o.total), 0),
    'profit', case
      when public.user_has_permission('products.cost.read') then coalesce(sum(profit_snapshot.profit), 0)
      else null
    end
  )
  from public.orders o
  left join public.order_profit_snapshots profit_snapshot
    on profit_snapshot.order_id = o.id
  where (
      coalesce(cardinality(p_statuses), 0) = 0
      or o.status = any(p_statuses)
    )
    and (
      nullif(trim(coalesce(p_invoice_query, '')), '') is null
      or position(lower(trim(p_invoice_query)) in lower(o.order_no)) > 0
    )
    and (
      nullif(trim(coalesce(p_customer_query, '')), '') is null
      or position(lower(trim(p_customer_query)) in lower(coalesce(o.customer_name, '') || ' ' || coalesce(o.customer_phone, ''))) > 0
    )
    and (
      coalesce(cardinality(p_product_skus), 0) = 0
      or exists (
        select 1
        from public.order_items oi
        where oi.order_id = o.id
          and oi.sku = any(p_product_skus)
      )
    )
    and (
      p_from is null
      or o.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
    )
    and (
      p_to is null
      or o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    );
$$;
revoke all on function public.orders_summary_filtered(text, text, text[], text[], date, date) from public, anon;
grant execute on function public.orders_summary_filtered(text, text, text[], text[], date, date) to authenticated;

-- Aggregate product totals using the same search and stock filters as the page.
create function public.get_products_page_summary(
  p_query text default '',
  p_stock_filter text default 'all'
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as (
    select p.stock, pc.cost
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
    where p.is_active
      and p.name ilike '%' || replace(replace(coalesce(p_query, ''), '%', ''), '_', '') || '%'
      and (
        p_stock_filter not in ('in-stock', 'out-of-stock')
        or (p_stock_filter = 'in-stock' and p.stock > 0)
        or (p_stock_filter = 'out-of-stock' and p.stock <= 0)
      )
  )
  select jsonb_build_object(
    'count', count(*),
    'stock_total', coalesce(sum(stock), 0),
    'inventory_capital', case
      when public.user_has_permission('products.cost.read') then coalesce(sum(stock * cost), 0)
      else null
    end
  ) from matches;
$$;
revoke all on function public.get_products_page_summary(text, text) from public, anon;
grant execute on function public.get_products_page_summary(text, text) to authenticated;

-- Keep inventory history footer totals complete even though the detail list is capped at 200 rows.
create function public.get_product_inventory_history_summary(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    public.user_has_permission('products.read') or
    public.user_has_permission('products.update')
  ) then
    raise exception 'Không có quyền xem lịch sử hàng hóa' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'count', count(*),
      'quantity_change_total', coalesce(sum(quantity_change), 0)
    )
    from public.inventory_movements
    where product_id = p_product_id
  );
end;
$$;
revoke all on function public.get_product_inventory_history_summary(uuid) from public, anon;
grant execute on function public.get_product_inventory_history_summary(uuid) to authenticated;
