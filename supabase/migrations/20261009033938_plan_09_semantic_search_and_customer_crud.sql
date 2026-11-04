-- Match every normalized query word anywhere in searchable text.
create or replace function public.search_matches(p_query text, p_text text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not exists (
    select 1
    from pg_catalog.regexp_split_to_table(
      extensions.unaccent(pg_catalog.lower(coalesce(p_query, ''))),
      '[[:space:]]+'
    ) as terms(token)
    where terms.token <> ''
      and pg_catalog.strpos(
        extensions.unaccent(pg_catalog.lower(coalesce(p_text, ''))),
        terms.token
      ) = 0
  );
$$;
revoke all on function public.search_matches(text, text) from public, anon;
grant execute on function public.search_matches(text, text) to authenticated;

-- Upgrade legacy customer managers to the equivalent separate CRUD grants.
update public.roles as r
set permissions = array(
  select distinct permission
  from unnest(
    coalesce(r.permissions, array[]::text[]) ||
    case
      when 'customers.manage' = any(coalesce(r.permissions, array[]::text[]))
        or (r.is_system and r.name = 'Admin')
      then array['customers.create', 'customers.update', 'customers.delete']::text[]
      else array[]::text[]
    end
  ) as permission
  where permission <> 'customers.manage'
)
where 'customers.manage' = any(coalesce(r.permissions, array[]::text[]))
   or (r.is_system and r.name = 'Admin');

drop policy if exists customers_read on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete on public.customers;

-- Update and delete need SELECT visibility under RLS. Create remains independent.
create policy customers_read on public.customers for select to authenticated
using (
  public.user_has_permission('customers.read') or
  public.user_has_permission('customers.update') or
  public.user_has_permission('customers.delete') or
  public.user_has_permission('sales.create')
);
create policy customers_insert on public.customers for insert to authenticated
with check (public.user_has_permission('customers.create'));
create policy customers_update on public.customers for update to authenticated
using (public.user_has_permission('customers.update'))
with check (public.user_has_permission('customers.update'));
create policy customers_delete on public.customers for delete to authenticated
using (public.user_has_permission('customers.delete'));

create or replace function public.search_customers(
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
    where public.search_matches(
      p_query,
      coalesce(name, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(address, '')
    )
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

-- Keep paged products and footer totals aligned with tokenized, accent-insensitive search.
create or replace function public.get_products_page(
  p_query text default '',
  p_stock_filter text default 'all',
  p_page integer default 1,
  p_page_size integer default 20,
  p_sort text default 'name',
  p_direction text default 'asc'
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as materialized (
    select p.id, p.sku, p.name, p.unit, p.stock
    from public.products p
    where p.is_active
      and public.search_matches(p_query, coalesce(p.name, '') || ' ' || coalesce(p.sku, ''))
      and (
        p_stock_filter not in ('in-stock', 'out-of-stock')
        or (p_stock_filter = 'in-stock' and p.stock > 0)
        or (p_stock_filter = 'out-of-stock' and p.stock <= 0)
      )
  ), ranked as (
    select matches.id,
      row_number() over (order by
        case when p_sort = 'sku' and lower(p_direction) <> 'desc' then sku end asc,
        case when p_sort = 'sku' and lower(p_direction) = 'desc' then sku end desc,
        case when p_sort = 'name' and lower(p_direction) <> 'desc' then name end asc,
        case when p_sort = 'name' and lower(p_direction) = 'desc' then name end desc,
        case when p_sort = 'unit' and lower(p_direction) <> 'desc' then unit end asc,
        case when p_sort = 'unit' and lower(p_direction) = 'desc' then unit end desc,
        case when p_sort = 'stock' and lower(p_direction) <> 'desc' then stock end asc,
        case when p_sort = 'stock' and lower(p_direction) = 'desc' then stock end desc,
        id asc) as sort_row
    from matches
  ), page as (
    select id, sort_row
    from ranked
    order by sort_row
    offset (greatest(1, p_page) - 1) * least(100, greatest(1, p_page_size))
    limit least(100, greatest(1, p_page_size))
  )
  select jsonb_build_object(
    'ids', coalesce((select jsonb_agg(page.id order by page.sort_row) from page), '[]'::jsonb),
    'total', (select count(*) from matches)
  );
$$;
revoke all on function public.get_products_page(text, text, integer, integer, text, text) from public, anon;
grant execute on function public.get_products_page(text, text, integer, integer, text, text) to authenticated;

create or replace function public.get_products_page_summary(
  p_query text default '',
  p_stock_filter text default 'all'
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as (
    select p.stock, pc.cost
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
    where p.is_active
      and public.search_matches(p_query, coalesce(p.name, '') || ' ' || coalesce(p.sku, ''))
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

create or replace function public.get_purchase_orders(
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

create or replace function public.orders_summary_filtered(
  p_invoice_query text default '',
  p_customer_query text default '',
  p_product_skus text[] default '{}',
  p_statuses text[] default array['completed']::text[],
  p_from date default null,
  p_to date default null
)
returns jsonb language sql stable security invoker set search_path = '' as $$
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

create or replace function public.orders_page_filtered(
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

create or replace function public.search_order_products(p_query text default '')
returns table(sku text, product_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct oi.sku, oi.product_name
  from public.order_items oi
  where public.search_matches(p_query, coalesce(oi.sku, '') || ' ' || coalesce(oi.product_name, ''))
  order by oi.sku, oi.product_name
  limit 500;
$$;
revoke all on function public.search_order_products(text) from public, anon;
grant execute on function public.search_order_products(text) to authenticated;
