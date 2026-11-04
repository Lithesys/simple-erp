-- Rollback for 20261010020929_plan_10_09_01_debts.sql.
-- Run only as a compensating migration after exporting any debt rows that must be retained.

begin;

drop function if exists public.search_debts(text, text, uuid, text, date, date, integer, integer, text, text);

drop table if exists public.debts;

update public.roles as r
set permissions = array(
  select permission
  from unnest(coalesce(r.permissions, array[]::text[])) as permission
  where permission <> all (
    array['debts.read', 'debts.create', 'debts.update', 'debts.delete', 'debts.report']::text[]
  )
)
where r.permissions && array[
  'debts.read', 'debts.create', 'debts.update', 'debts.delete', 'debts.report'
]::text[];

-- Restore the customers_read policy that existed before the debt feature.
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
using (
  public.user_has_permission('customers.read') or
  public.user_has_permission('customers.update') or
  public.user_has_permission('customers.delete') or
  public.user_has_permission('sales.create')
);

commit;
