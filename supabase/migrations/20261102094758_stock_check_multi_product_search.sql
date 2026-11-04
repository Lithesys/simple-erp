create or replace function public.get_stock_checks(
  p_from date default null,
  p_to date default null,
  p_query text default '',
  p_statuses text[] default null,
  p_sort text default 'created_at',
  p_direction text default 'desc',
  p_limit integer default 1000,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total bigint;
  v_query text := btrim(coalesce(p_query, ''));
  v_normalized_query text;
  v_product_terms text[];
begin
  if auth.uid() is null or not (
    public.user_has_permission('stock_checks.read') or
    public.user_has_permission('stock_checks.update') or
    public.user_has_permission('stock_checks.delete') or
    public.user_has_permission('stock_checks.complete')
  ) then
    raise exception 'Không có quyền xem danh sách kiểm kho' using errcode = '42501';
  end if;

  select coalesce(array_agg(btrim(split.term)), array[]::text[])
  into v_product_terms
  from pg_catalog.regexp_split_to_table(
    pg_catalog.replace(pg_catalog.replace(v_query, E'\n', ','), E'\r', ','),
    '[,;]+'
  ) as split(term)
  where btrim(split.term) <> '';

  v_normalized_query := pg_catalog.translate(
    extensions.unaccent(pg_catalog.lower(v_query)),
    'đ',
    'd'
  );

  with filtered as (
    select
      sc.*,
      coalesce(nullif(pr.display_name, ''), '—') as actor_name,
      count(si.id)::integer as item_count,
      coalesce(sum(si.applied_delta), 0) as delta_total,
      case
        when public.user_has_permission('products.cost.read')
          then sum(si.applied_delta * si.unit_cost_snapshot)
        else null
      end as value_delta_total
    from public.stock_checks sc
    left join public.profiles pr on pr.id = sc.created_by
    left join public.stock_check_items si on si.stock_check_id = sc.id
    where (p_from is null or (sc.created_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from)
      and (p_to is null or (sc.created_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to)
      and (
        v_query = ''
        or (
          cardinality(v_product_terms) <= 1
          and (
            sc.stock_check_no ilike '%' || v_query || '%'
            or sc.note ilike '%' || v_query || '%'
            or coalesce(nullif(pr.display_name, ''), '—') ilike '%' || v_query || '%'
            or public.search_phrase_matches(
              v_query,
              coalesce(nullif(pr.display_name, ''), '—')
            )
            or pg_catalog.translate(
              extensions.unaccent(
                pg_catalog.lower(coalesce(nullif(pr.display_name, ''), '—'))
              ),
              'đ',
              'd'
            ) like '%' || v_normalized_query || '%'
            or exists (
              select 1
              from public.stock_check_items match_item
              where match_item.stock_check_id = sc.id
                and (
                  match_item.product_name ilike '%' || v_query || '%'
                  or match_item.sku ilike '%' || v_query || '%'
                  or public.search_phrase_matches(v_query, match_item.product_name)
                  or public.search_phrase_matches(v_query, match_item.sku)
                  or pg_catalog.translate(
                    extensions.unaccent(pg_catalog.lower(match_item.product_name)),
                    'đ',
                    'd'
                  ) like '%' || v_normalized_query || '%'
                )
            )
          )
        )
        or (
          cardinality(v_product_terms) > 1
          and not exists (
            select 1
            from unnest(v_product_terms) as requested(term)
            where not exists (
              select 1
              from public.stock_check_items match_item
              where match_item.stock_check_id = sc.id
                and (
                  match_item.product_name ilike '%' || requested.term || '%'
                  or match_item.sku ilike '%' || requested.term || '%'
                  or public.search_phrase_matches(requested.term, match_item.product_name)
                  or public.search_phrase_matches(requested.term, match_item.sku)
                  or pg_catalog.translate(
                    extensions.unaccent(pg_catalog.lower(match_item.product_name)),
                    'đ',
                    'd'
                  ) like '%' || pg_catalog.translate(
                    extensions.unaccent(pg_catalog.lower(requested.term)),
                    'đ',
                    'd'
                  ) || '%'
                )
            )
          )
        )
      )
      and (coalesce(cardinality(p_statuses), 0) = 0 or sc.status = any(p_statuses))
    group by sc.id, pr.display_name
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select
      sc.*,
      coalesce(nullif(pr.display_name, ''), '—') as actor_name,
      count(si.id)::integer as item_count,
      coalesce(sum(si.applied_delta), 0) as delta_total,
      case
        when public.user_has_permission('products.cost.read')
          then sum(si.applied_delta * si.unit_cost_snapshot)
        else null
      end as value_delta_total
    from public.stock_checks sc
    left join public.profiles pr on pr.id = sc.created_by
    left join public.stock_check_items si on si.stock_check_id = sc.id
    where (p_from is null or (sc.created_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from)
      and (p_to is null or (sc.created_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to)
      and (
        v_query = ''
        or (
          cardinality(v_product_terms) <= 1
          and (
            sc.stock_check_no ilike '%' || v_query || '%'
            or sc.note ilike '%' || v_query || '%'
            or coalesce(nullif(pr.display_name, ''), '—') ilike '%' || v_query || '%'
            or public.search_phrase_matches(
              v_query,
              coalesce(nullif(pr.display_name, ''), '—')
            )
            or pg_catalog.translate(
              extensions.unaccent(
                pg_catalog.lower(coalesce(nullif(pr.display_name, ''), '—'))
              ),
              'đ',
              'd'
            ) like '%' || v_normalized_query || '%'
            or exists (
              select 1
              from public.stock_check_items match_item
              where match_item.stock_check_id = sc.id
                and (
                  match_item.product_name ilike '%' || v_query || '%'
                  or match_item.sku ilike '%' || v_query || '%'
                  or public.search_phrase_matches(v_query, match_item.product_name)
                  or public.search_phrase_matches(v_query, match_item.sku)
                  or pg_catalog.translate(
                    extensions.unaccent(pg_catalog.lower(match_item.product_name)),
                    'đ',
                    'd'
                  ) like '%' || v_normalized_query || '%'
                )
            )
          )
        )
        or (
          cardinality(v_product_terms) > 1
          and not exists (
            select 1
            from unnest(v_product_terms) as requested(term)
            where not exists (
              select 1
              from public.stock_check_items match_item
              where match_item.stock_check_id = sc.id
                and (
                  match_item.product_name ilike '%' || requested.term || '%'
                  or match_item.sku ilike '%' || requested.term || '%'
                  or public.search_phrase_matches(requested.term, match_item.product_name)
                  or public.search_phrase_matches(requested.term, match_item.sku)
                  or pg_catalog.translate(
                    extensions.unaccent(pg_catalog.lower(match_item.product_name)),
                    'đ',
                    'd'
                  ) like '%' || pg_catalog.translate(
                    extensions.unaccent(pg_catalog.lower(requested.term)),
                    'đ',
                    'd'
                  ) || '%'
                )
            )
          )
        )
      )
      and (coalesce(cardinality(p_statuses), 0) = 0 or sc.status = any(p_statuses))
    group by sc.id, pr.display_name
  ), page as (
    select *
    from filtered
    order by
      case when p_sort = 'stock_check_no' and p_direction = 'asc' then stock_check_no end asc,
      case when p_sort = 'stock_check_no' and p_direction <> 'asc' then stock_check_no end desc,
      case when p_sort = 'status' and p_direction = 'asc' then status end asc,
      case when p_sort = 'status' and p_direction <> 'asc' then status end desc,
      case when p_sort = 'created_at' and p_direction = 'asc' then created_at end asc,
      case when p_sort <> 'stock_check_no' and p_sort <> 'status' and p_direction <> 'asc' then created_at end desc,
      id desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'stock_check_no', stock_check_no,
    'status', status,
    'note', note,
    'created_at', created_at,
    'created_by', created_by,
    'actor_name', actor_name,
    'updated_at', updated_at,
    'completed_at', completed_at,
    'completed_by', completed_by,
    'cancelled_at', cancelled_at,
    'cancelled_by', cancelled_by,
    'item_count', item_count,
    'delta_total', delta_total,
    'value_delta_total', value_delta_total
  ) order by
    case when p_sort = 'stock_check_no' and p_direction = 'asc' then stock_check_no end asc,
    case when p_sort = 'stock_check_no' and p_direction <> 'asc' then stock_check_no end desc,
    case when p_sort = 'status' and p_direction = 'asc' then status end asc,
    case when p_sort = 'status' and p_direction <> 'asc' then status end desc,
    case when p_sort = 'created_at' and p_direction = 'asc' then created_at end asc,
    case when p_sort <> 'stock_check_no' and p_sort <> 'status' and p_direction <> 'asc' then created_at end desc,
    id desc), '[]'::jsonb)
  into v_rows
  from page;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke all on function public.get_stock_checks(date, date, text, text[], text, text, integer, integer) from public, anon;
grant execute on function public.get_stock_checks(date, date, text, text[], text, text, integer, integer) to authenticated;
