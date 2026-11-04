create table public.debts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  debt_item text not null check (length(btrim(debt_item)) between 1 and 160),
  quantity numeric(14, 3) not null check (quantity > 0),
  debt_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  paid_date date,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index debts_debt_date_id_idx on public.debts (debt_date desc, id desc);
create index debts_customer_item_date_idx
  on public.debts (customer_id, debt_item, debt_date desc, id desc);
create trigger debts_touch before update on public.debts
  for each row execute function public.touch_updated_at();

alter table public.debts enable row level security;
revoke all on public.debts from anon, authenticated;
grant select, insert, update, delete on public.debts to authenticated;
grant all on public.debts to service_role;

create policy debts_read on public.debts for select to authenticated
using (
  public.user_has_permission('debts.read') or
  public.user_has_permission('debts.update') or
  public.user_has_permission('debts.delete') or
  public.user_has_permission('debts.report')
);
create policy debts_insert on public.debts for insert to authenticated
with check (public.user_has_permission('debts.create'));
create policy debts_update on public.debts for update to authenticated
using (public.user_has_permission('debts.update'))
with check (public.user_has_permission('debts.update'));
create policy debts_delete on public.debts for delete to authenticated
using (public.user_has_permission('debts.delete'));

-- Debt screens need customer names for reference pickers and reports.
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
using (
  public.user_has_permission('customers.read') or
  public.user_has_permission('customers.update') or
  public.user_has_permission('customers.delete') or
  public.user_has_permission('sales.create') or
  public.user_has_permission('debts.read') or
  public.user_has_permission('debts.create') or
  public.user_has_permission('debts.update') or
  public.user_has_permission('debts.delete') or
  public.user_has_permission('debts.report')
);

update public.roles as r
set permissions = array(
  select distinct permission
  from unnest(
    coalesce(r.permissions, array[]::text[]) ||
    array['debts.read', 'debts.create', 'debts.update', 'debts.delete', 'debts.report']::text[]
  ) as permission
)
where r.is_system and r.name = 'Admin';

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

revoke all on function public.search_debts(text, text, uuid, text, date, date, integer, integer, text, text)
  from public, anon;
grant execute on function public.search_debts(text, text, uuid, text, date, date, integer, integer, text, text)
  to authenticated;
