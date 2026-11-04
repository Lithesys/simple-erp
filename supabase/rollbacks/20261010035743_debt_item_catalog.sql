drop function if exists public.rename_debt_item(uuid, text);
create or replace function public.search_debts(
  p_query text default '',
  p_status text default 'all',
  p_customer_id uuid default null,
  p_item text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'debt_date',
  p_direction text default 'desc'
)
returns table (
  id uuid,
  customer_id uuid,
  customer_name text,
  debt_item text,
  quantity numeric,
  debt_date date,
  paid_date date,
  total_rows bigint,
  total_quantity numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with matches as materialized (
    select
      d.id,
      d.customer_id,
      c.name as customer_name,
      d.debt_item,
      d.quantity,
      d.debt_date,
      d.paid_date
    from public.debts as d
    join public.customers as c on c.id = d.customer_id
    where
      (coalesce(p_query, '') = '' or public.search_matches(p_query, c.name || ' ' || d.debt_item))
      and (p_status not in ('paid', 'unpaid') or (d.paid_date is not null) = (p_status = 'paid'))
      and (p_customer_id is null or d.customer_id = p_customer_id)
      and (p_item is null or d.debt_item = p_item)
      and (p_from is null or d.debt_date >= p_from)
      and (p_to is null or d.debt_date <= p_to)
  )
  select
    m.id,
    m.customer_id,
    m.customer_name,
    m.debt_item,
    m.quantity,
    m.debt_date,
    m.paid_date,
    count(*) over () as total_rows,
    coalesce(sum(m.quantity) over (), 0) as total_quantity
  from matches as m
  order by
    case when p_sort = 'customer_name' and p_direction = 'asc' then m.customer_name end asc nulls last,
    case when p_sort = 'customer_name' and p_direction = 'desc' then m.customer_name end desc nulls last,
    case when p_sort = 'debt_item' and p_direction = 'asc' then m.debt_item end asc nulls last,
    case when p_sort = 'debt_item' and p_direction = 'desc' then m.debt_item end desc nulls last,
    case when p_sort = 'quantity' and p_direction = 'asc' then m.quantity end asc nulls last,
    case when p_sort = 'quantity' and p_direction = 'desc' then m.quantity end desc nulls last,
    case when p_sort = 'debt_date' and p_direction = 'asc' then m.debt_date end asc nulls last,
    case when p_sort = 'debt_date' and p_direction = 'desc' then m.debt_date end desc nulls last,
    case when p_sort = 'paid_date' and p_direction = 'asc' then m.paid_date end asc nulls last,
    case when p_sort = 'paid_date' and p_direction = 'desc' then m.paid_date end desc nulls last,
    m.debt_date desc,
    m.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

drop index if exists public.debts_debt_item_id_idx;
alter table public.debts drop column if exists debt_item_id;
drop trigger if exists debt_items_touch on public.debt_items;
drop index if exists public.debt_items_name_normalized_idx;
drop table if exists public.debt_items;

revoke all on function public.search_debts(text, text, uuid, text, date, date, integer, integer, text, text)
  from public, anon;
grant execute on function public.search_debts(text, text, uuid, text, date, date, integer, integer, text, text)
  to authenticated;
