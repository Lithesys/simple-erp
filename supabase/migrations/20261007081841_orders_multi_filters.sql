create index if not exists order_items_sku_order_idx on public.order_items(sku, order_id);

create or replace function public.orders_summary_filtered(
  p_invoice_query text default '',
  p_customer_query text default '',
  p_product_skus text[] default '{}',
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
    'total', coalesce(sum(o.total), 0)
  )
  from public.orders o
  where o.status = 'completed'
    and (
      nullif(trim(coalesce(p_invoice_query, '')), '') is null
      or position(lower(trim(p_invoice_query)) in lower(o.order_no)) > 0
    )
    and (
      nullif(trim(coalesce(p_customer_query, '')), '') is null
      or position(lower(trim(p_customer_query)) in lower(o.customer_name || ' ' || o.customer_phone)) > 0
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

revoke all on function public.orders_summary_filtered(text, text, text[], date, date) from public, anon;
grant execute on function public.orders_summary_filtered(text, text, text[], date, date) to authenticated;
