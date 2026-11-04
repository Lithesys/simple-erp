-- Prefer an ordered, adjacent word phrase for multi-word product searches.
-- The existing token search remains the fallback when no phrase match exists.
create or replace function public.search_phrase_matches(p_query text, p_text text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  with search_terms as (
    select
      array(
        select split.token
        from pg_catalog.regexp_split_to_table(
          pg_catalog.translate(
            extensions.unaccent(
              pg_catalog.lower(pg_catalog.btrim(coalesce(p_query, '')))
            ),
            'đ',
            'd'
          ),
          '[^[:alnum:]]+'
        ) with ordinality as split(token, ordinality)
        where split.token <> ''
        order by split.ordinality
      ) as query_tokens,
      array(
        select split.token
        from pg_catalog.regexp_split_to_table(
          pg_catalog.translate(
            extensions.unaccent(
              pg_catalog.lower(coalesce(p_text, ''))
            ),
            'đ',
            'd'
          ),
          '[^[:alnum:]]+'
        ) with ordinality as split(token, ordinality)
        where split.token <> ''
        order by split.ordinality
      ) as text_tokens
  )
  select
    pg_catalog.cardinality(query_tokens) > 1
    and pg_catalog.cardinality(text_tokens) >= pg_catalog.cardinality(query_tokens)
    and exists (
      select 1
      from pg_catalog.generate_series(
        1,
        pg_catalog.cardinality(text_tokens) - pg_catalog.cardinality(query_tokens) + 1
      ) as positions(start_at)
      where text_tokens[
        positions.start_at : positions.start_at + pg_catalog.cardinality(query_tokens) - 1
      ] = query_tokens
    )
  from search_terms;
$$;
revoke all on function public.search_phrase_matches(text, text) from public, anon;
grant execute on function public.search_phrase_matches(text, text) to authenticated;

create or replace function public.get_products_page(
  p_query text default '',
  p_stock_filter text default 'all',
  p_page integer default 1,
  p_page_size integer default 20,
  p_sort text default 'name',
  p_direction text default 'asc',
  p_status_filter text default 'active'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as materialized (
    select p.id, p.sku, p.name, p.unit, p.stock
    from public.products p
    where (
        case p_status_filter
          when 'inactive' then not p.is_active
          when 'all' then true
          else p.is_active
        end
      )
      and (
        p_stock_filter not in ('in-stock', 'out-of-stock')
        or (p_stock_filter = 'in-stock' and p.stock > 0)
        or (p_stock_filter = 'out-of-stock' and p.stock <= 0)
      )
  ), phrase_matches as materialized (
    select eligible.*
    from eligible
    where public.search_phrase_matches(p_query, eligible.name)
       or public.search_phrase_matches(p_query, eligible.sku)
  ), matches as materialized (
    select phrase_matches.*
    from phrase_matches
    union all
    select eligible.*
    from eligible
    where not exists (select 1 from phrase_matches)
      and public.search_matches(
        p_query,
        coalesce(eligible.name, '') || ' ' || coalesce(eligible.sku, '')
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
revoke all on function public.get_products_page(text, text, integer, integer, text, text, text) from public, anon;
grant execute on function public.get_products_page(text, text, integer, integer, text, text, text) to authenticated;

create or replace function public.get_products_page_summary(
  p_query text default '',
  p_stock_filter text default 'all',
  p_status_filter text default 'active'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as materialized (
    select p.id, p.sku, p.name, p.stock, pc.cost
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
    where (
        case p_status_filter
          when 'inactive' then not p.is_active
          when 'all' then true
          else p.is_active
        end
      )
      and (
        p_stock_filter not in ('in-stock', 'out-of-stock')
        or (p_stock_filter = 'in-stock' and p.stock > 0)
        or (p_stock_filter = 'out-of-stock' and p.stock <= 0)
      )
  ), phrase_matches as materialized (
    select eligible.*
    from eligible
    where public.search_phrase_matches(p_query, eligible.name)
       or public.search_phrase_matches(p_query, eligible.sku)
  ), matches as materialized (
    select phrase_matches.*
    from phrase_matches
    union all
    select eligible.*
    from eligible
    where not exists (select 1 from phrase_matches)
      and public.search_matches(
        p_query,
        coalesce(eligible.name, '') || ' ' || coalesce(eligible.sku, '')
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
revoke all on function public.get_products_page_summary(text, text, text) from public, anon;
grant execute on function public.get_products_page_summary(text, text, text) to authenticated;

create or replace function public.get_stock_check_products(p_query text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_has_phrase_match boolean;
begin
  if auth.uid() is null or not (
    public.user_has_permission('stock_checks.read') or
    public.user_has_permission('stock_checks.create') or
    public.user_has_permission('stock_checks.update')
  ) then
    raise exception 'Không có quyền tìm hàng hóa để kiểm kho' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.products p
    where p.is_active
      and p.kind = 'product'
      and (
        public.search_phrase_matches(p_query, p.name)
        or public.search_phrase_matches(p_query, p.sku)
      )
  ) into v_has_phrase_match;

  if v_has_phrase_match then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit, 'stock', p.stock,
      'unit_cost', case when public.user_has_permission('products.cost.read') then pc.cost else null end
    ) order by p.name, p.sku), '[]'::jsonb)
    into v_rows
    from (
      select * from public.products
      where is_active and kind = 'product'
        and (
          public.search_phrase_matches(p_query, name)
          or public.search_phrase_matches(p_query, sku)
        )
      order by name, sku limit 100
    ) p
    left join public.product_costs pc on pc.product_id = p.id;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit, 'stock', p.stock,
      'unit_cost', case when public.user_has_permission('products.cost.read') then pc.cost else null end
    ) order by p.name, p.sku), '[]'::jsonb)
    into v_rows
    from (
      select * from public.products
      where is_active and kind = 'product'
        and (
          coalesce(trim(p_query), '') = ''
          or sku ilike '%' || trim(p_query) || '%'
          or name ilike '%' || trim(p_query) || '%'
        )
      order by name, sku limit 100
    ) p
    left join public.product_costs pc on pc.product_id = p.id;
  end if;

  return v_rows;
end;
$$;
revoke all on function public.get_stock_check_products(text) from public, anon;
grant execute on function public.get_stock_check_products(text) to authenticated;

create or replace function public.search_order_products(p_query text default '')
returns table(sku text, product_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as materialized (
    select distinct oi.sku, oi.product_name
    from public.order_items oi
  ), phrase_matches as materialized (
    select eligible.*
    from eligible
    where public.search_phrase_matches(p_query, eligible.product_name)
       or public.search_phrase_matches(p_query, eligible.sku)
  ), matches as materialized (
    select phrase_matches.*
    from phrase_matches
    union all
    select eligible.*
    from eligible
    where not exists (select 1 from phrase_matches)
      and public.search_matches(
        p_query,
        coalesce(eligible.sku, '') || ' ' || coalesce(eligible.product_name, '')
      )
  )
  select distinct matches.sku, matches.product_name
  from matches
  order by matches.sku, matches.product_name
  limit 500;
$$;
revoke all on function public.search_order_products(text) from public, anon;
grant execute on function public.search_order_products(text) to authenticated;
