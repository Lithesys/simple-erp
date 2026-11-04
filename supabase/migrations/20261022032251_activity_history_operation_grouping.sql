create or replace function public.get_activity_history(
  p_from date default null,
  p_to date default null,
  p_query text default '',
  p_employee uuid default null,
  p_feature text default null,
  p_action text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'occurred_at',
  p_direction text default 'desc'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with operations as materialized (
    select
      min(h.id) as id,
      h.operation_id,
      min(h.occurred_at) as occurred_at,
      h.actor_id,
      max(h.actor_name) as actor_name,
      string_agg(distinct h.feature, ' · ' order by h.feature) as feature,
      string_agg(distinct h.action, ' · ' order by h.action) as action,
      string_agg(distinct nullif(h.entity_label, ''), ' · ' order by nullif(h.entity_label, '')) as entity_label,
      jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'action', h.action,
          'entity_type', h.entity_type,
          'entity_id', h.entity_id,
          'entity_label', h.entity_label,
          'changed_fields', h.changed_fields,
          'device', h.device,
          'auth_event', h.auth_event
        ) order by h.id
      ) as details
    from public.activity_history h
    where public.user_has_permission('activity_history.read')
    group by h.operation_id, h.actor_id
  ), filtered as materialized (
    select o.*
    from operations o
    where (p_from is null or o.occurred_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_to is null or o.occurred_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (p_employee is null or o.actor_id = p_employee)
      and (
        p_feature is null
        or exists (
          select 1 from jsonb_array_elements(o.details) as x(detail)
          where x.detail->>'feature' = p_feature
        )
      )
      and (
        p_action is null
        or exists (
          select 1 from jsonb_array_elements(o.details) as x(detail)
          where x.detail->>'action' = p_action
        )
      )
      and (
        nullif(btrim(p_query), '') is null
        or o.actor_name ilike '%' || btrim(p_query) || '%'
        or o.feature ilike '%' || btrim(p_query) || '%'
        or o.action ilike '%' || btrim(p_query) || '%'
        or o.entity_label ilike '%' || btrim(p_query) || '%'
        or o.details::text ilike '%' || btrim(p_query) || '%'
      )
  ), ranked as (
    select f.*, count(*) over () as total_count,
      row_number() over (order by
        case when p_sort = 'actor_name' and p_direction = 'asc' then f.actor_name end asc,
        case when p_sort = 'actor_name' and p_direction = 'desc' then f.actor_name end desc,
        case when p_sort = 'feature' and p_direction = 'asc' then f.feature end asc,
        case when p_sort = 'feature' and p_direction = 'desc' then f.feature end desc,
        case when p_sort = 'details' and p_direction = 'asc' then f.entity_label end asc,
        case when p_sort = 'details' and p_direction = 'desc' then f.entity_label end desc,
        case when p_sort = 'occurred_at' and p_direction = 'asc' then f.occurred_at end asc,
        case when p_sort = 'occurred_at' and p_direction = 'desc' then f.occurred_at end desc,
        f.occurred_at desc, f.id desc
      ) as sort_order
    from filtered f
  ), page_rows as (
    select * from ranked
    order by sort_order
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(
      (to_jsonb(page_rows) - 'total_count' - 'sort_order') order by sort_order
    ), '[]'::jsonb),
    'total', coalesce(max(total_count), 0)
  ) from page_rows;
$$;

revoke all on function public.get_activity_history(date, date, text, uuid, text, text, integer, integer, text, text) from public, anon;
grant execute on function public.get_activity_history(date, date, text, uuid, text, text, integer, integer, text, text) to authenticated;
