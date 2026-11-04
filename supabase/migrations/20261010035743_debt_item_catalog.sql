create table public.debt_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index debt_items_name_normalized_idx
  on public.debt_items (lower(btrim(name)));

create trigger debt_items_touch before update on public.debt_items
  for each row execute function public.touch_updated_at();

alter table public.debts
  add column debt_item_id uuid references public.debt_items(id) on delete set null;

insert into public.debt_items (name)
select min(btrim(d.debt_item))
from public.debts as d
where length(btrim(d.debt_item)) between 1 and 160
group by lower(btrim(d.debt_item))
on conflict do nothing;

update public.debts as d
set debt_item_id = i.id
from public.debt_items as i
where lower(btrim(d.debt_item)) = lower(btrim(i.name));

create index debts_debt_item_id_idx on public.debts (debt_item_id);

alter table public.debt_items enable row level security;
revoke all on public.debt_items from anon, authenticated;
grant select, insert, update, delete on public.debt_items to authenticated;
grant all on public.debt_items to service_role;

create policy debt_items_read on public.debt_items for select to authenticated
using (
  public.user_has_permission('debts.read') or
  public.user_has_permission('debts.create') or
  public.user_has_permission('debts.update') or
  public.user_has_permission('debts.delete') or
  public.user_has_permission('debts.report')
);
create policy debt_items_insert on public.debt_items for insert to authenticated
with check (public.user_has_permission('debts.create'));
create policy debt_items_update on public.debt_items for update to authenticated
using (public.user_has_permission('debts.update'))
with check (public.user_has_permission('debts.update'));
create policy debt_items_delete on public.debt_items for delete to authenticated
using (public.user_has_permission('debts.delete'));

create or replace function public.rename_debt_item(p_item_id uuid, p_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.user_has_permission('debts.update') then
    raise insufficient_privilege using message = 'Missing permission: debts.update';
  end if;
  if length(v_name) not between 1 and 160 then
    raise check_violation using message = 'Debt type name must be between 1 and 160 characters.';
  end if;

  update public.debt_items
  set name = v_name
  where id = p_item_id;

  if not found then
    raise no_data_found using message = 'Debt type not found.';
  end if;

  update public.debts
  set debt_item = v_name
  where debt_item_id = p_item_id;
end;
$$;

revoke all on function public.rename_debt_item(uuid, text) from public, anon;
grant execute on function public.rename_debt_item(uuid, text) to authenticated;

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
      coalesce(i.name, d.debt_item) as debt_item,
      d.quantity,
      d.debt_date,
      d.paid_date
    from public.debts as d
    join public.customers as c on c.id = d.customer_id
    left join public.debt_items as i on i.id = d.debt_item_id
    where
      (coalesce(p_query, '') = '' or public.search_matches(p_query, c.name || ' ' || coalesce(i.name, d.debt_item)))
      and (p_status not in ('paid', 'unpaid') or (d.paid_date is not null) = (p_status = 'paid'))
      and (p_customer_id is null or d.customer_id = p_customer_id)
      and (p_item is null or coalesce(i.name, d.debt_item) = p_item)
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

revoke all on function public.search_debts(text, text, uuid, text, date, date, integer, integer, text, text)
  from public, anon;
grant execute on function public.search_debts(text, text, uuid, text, date, date, integer, integer, text, text)
  to authenticated;
