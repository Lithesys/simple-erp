-- Let customer suggestions match Vietnamese names regardless of typed accents.
create extension if not exists unaccent with schema extensions;
alter extension unaccent set schema extensions;

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
    where position(
      extensions.unaccent(lower(trim(coalesce(p_query, ''))))
      in extensions.unaccent(lower(name || ' ' || phone || ' ' || address))
    ) > 0
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
