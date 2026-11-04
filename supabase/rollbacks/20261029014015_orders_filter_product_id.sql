drop function if exists public.orders_page_filtered(
  text, text, text[], text[], date, date, text, text, integer, integer, uuid
);
drop function if exists public.orders_summary_filtered(
  text, text, text[], text[], date, date, uuid
);

create function public.orders_summary_filtered(
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
    'subtotal', coalesce(sum(case when o.status = 'completed' then o.subtotal else 0 end), 0),
    'discount', coalesce(sum(case when o.status = 'completed' then o.discount else 0 end), 0),
    'total', coalesce(sum(case when o.status = 'completed' then o.total else 0 end), 0),
    'profit', case
      when public.user_has_permission('products.cost.read') then
        coalesce(sum(case when o.status = 'completed' then profit_snapshot.profit else 0 end), 0)
      else null
    end
  )
  from public.orders o
  left join public.order_profit_snapshots profit_snapshot
    on profit_snapshot.order_id = o.id
  where (coalesce(cardinality(p_statuses), 0) = 0 or o.status = any(p_statuses))
    and public.search_matches(p_invoice_query, o.order_no)
    and public.search_matches(
      p_customer_query,
      coalesce(o.customer_name, '') || ' ' || coalesce(o.customer_phone, '')
    )
    and (
      coalesce(cardinality(p_product_skus), 0) = 0
      or exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id and oi.sku = any(p_product_skus)
      )
    )
    and (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
    and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'));
$$;
revoke all on function public.orders_summary_filtered(text, text, text[], text[], date, date) from public, anon;
grant execute on function public.orders_summary_filtered(text, text, text[], text[], date, date) to authenticated;

create function public.orders_page_filtered(
  p_invoice_query text default '',
  p_customer_query text default '',
  p_product_skus text[] default '{}',
  p_statuses text[] default array['completed']::text[],
  p_from date default null,
  p_to date default null,
  p_sort text default 'created_at',
  p_direction text default 'desc',
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with matches as materialized (
    select o.id, o.order_no, o.customer_name, o.status, o.price_list_name,
      o.discount, o.total, o.created_at, profit_snapshot.profit
    from public.orders o
    left join public.order_profit_snapshots profit_snapshot
      on profit_snapshot.order_id = o.id
    where (coalesce(cardinality(p_statuses), 0) = 0 or o.status = any(p_statuses))
      and public.search_matches(p_invoice_query, o.order_no)
      and public.search_matches(
        p_customer_query,
        coalesce(o.customer_name, '') || ' ' || coalesce(o.customer_phone, '')
      )
      and (
        coalesce(cardinality(p_product_skus), 0) = 0
        or exists (
          select 1 from public.order_items oi
          where oi.order_id = o.id and oi.sku = any(p_product_skus)
        )
      )
      and (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (
        p_sort <> 'profit'
        or not public.user_has_permission('products.cost.read')
        or profit_snapshot.order_id is not null
      )
  ), ranked as (
    select matches.id,
      row_number() over (order by
        case when p_sort = 'order_no' and lower(p_direction) = 'asc' then order_no end asc,
        case when p_sort = 'order_no' and lower(p_direction) <> 'asc' then order_no end desc,
        case when p_sort = 'created_at' and lower(p_direction) = 'asc' then created_at end asc,
        case when p_sort = 'created_at' and lower(p_direction) <> 'asc' then created_at end desc,
        case when p_sort = 'customer' and lower(p_direction) = 'asc' then customer_name end asc,
        case when p_sort = 'customer' and lower(p_direction) <> 'asc' then customer_name end desc,
        case when p_sort = 'status' and lower(p_direction) = 'asc' then status end asc,
        case when p_sort = 'status' and lower(p_direction) <> 'asc' then status end desc,
        case when p_sort = 'price_list' and lower(p_direction) = 'asc' then price_list_name end asc,
        case when p_sort = 'price_list' and lower(p_direction) <> 'asc' then price_list_name end desc,
        case when p_sort = 'discount' and lower(p_direction) = 'asc' then discount end asc,
        case when p_sort = 'discount' and lower(p_direction) <> 'asc' then discount end desc,
        case when p_sort = 'total' and lower(p_direction) = 'asc' then total end asc,
        case when p_sort = 'total' and lower(p_direction) <> 'asc' then total end desc,
        case when p_sort = 'profit' and public.user_has_permission('products.cost.read') and lower(p_direction) = 'asc' then profit end asc,
        case when p_sort = 'profit' and public.user_has_permission('products.cost.read') and lower(p_direction) <> 'asc' then profit end desc,
        id asc) as sort_row
    from matches
  ), page as (
    select id, sort_row
    from ranked
    order by sort_row
    offset greatest(0, p_offset)
    limit least(100, greatest(1, p_limit))
  )
  select jsonb_build_object(
    'ids', coalesce((select jsonb_agg(page.id order by page.sort_row) from page), '[]'::jsonb),
    'total', (select count(*) from matches)
  );
$$;
revoke all on function public.orders_page_filtered(text, text, text[], text[], date, date, text, text, integer, integer) from public, anon;
grant execute on function public.orders_page_filtered(text, text, text[], text[], date, date, text, text, integer, integer) to authenticated;
