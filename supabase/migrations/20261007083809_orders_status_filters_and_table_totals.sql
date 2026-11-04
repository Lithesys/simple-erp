alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check check (status in ('completed', 'cancelled'));

create index if not exists orders_status_created_at_idx on public.orders(status, created_at desc);

drop function if exists public.orders_summary_filtered(text, text, text[], date, date);

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
    'subtotal', coalesce(sum(o.subtotal), 0),
    'discount', coalesce(sum(o.discount), 0),
    'total', coalesce(sum(o.total), 0)
  )
  from public.orders o
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
