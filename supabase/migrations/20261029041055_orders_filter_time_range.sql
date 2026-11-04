create function public.orders_summary_filtered(
  p_invoice_query text,
  p_customer_query text,
  p_product_skus text[],
  p_statuses text[],
  p_from date,
  p_to date,
  p_product_id uuid,
  p_from_time time without time zone,
  p_to_time time without time zone
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
      (coalesce(cardinality(p_product_skus), 0) = 0 and p_product_id is null)
      or exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id
          and (oi.sku = any(p_product_skus) or oi.product_id = p_product_id)
      )
    )
    and (p_from is null or o.created_at >= ((p_from + coalesce(p_from_time, time '00:00')) at time zone 'Asia/Ho_Chi_Minh'))
    and (p_to is null or o.created_at < (case when p_to_time is null then ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') else ((p_to + p_to_time + interval '1 minute') at time zone 'Asia/Ho_Chi_Minh') end));
$$;
revoke all on function public.orders_summary_filtered(text, text, text[], text[], date, date, uuid, time without time zone, time without time zone) from public, anon;
grant execute on function public.orders_summary_filtered(text, text, text[], text[], date, date, uuid, time without time zone, time without time zone) to authenticated;

create function public.orders_page_filtered(
  p_invoice_query text,
  p_customer_query text,
  p_product_skus text[],
  p_statuses text[],
  p_from date,
  p_to date,
  p_sort text,
  p_direction text,
  p_offset integer,
  p_limit integer,
  p_product_id uuid,
  p_from_time time without time zone,
  p_to_time time without time zone
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
        (coalesce(cardinality(p_product_skus), 0) = 0 and p_product_id is null)
        or exists (
          select 1 from public.order_items oi
          where oi.order_id = o.id
            and (oi.sku = any(p_product_skus) or oi.product_id = p_product_id)
        )
      )
      and (p_from is null or o.created_at >= ((p_from + coalesce(p_from_time, time '00:00')) at time zone 'Asia/Ho_Chi_Minh'))
      and (p_to is null or o.created_at < (case when p_to_time is null then ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') else ((p_to + p_to_time + interval '1 minute') at time zone 'Asia/Ho_Chi_Minh') end))
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
revoke all on function public.orders_page_filtered(text, text, text[], text[], date, date, text, text, integer, integer, uuid, time without time zone, time without time zone) from public, anon;
grant execute on function public.orders_page_filtered(text, text, text[], text[], date, date, text, text, integer, integer, uuid, time without time zone, time without time zone) to authenticated;
