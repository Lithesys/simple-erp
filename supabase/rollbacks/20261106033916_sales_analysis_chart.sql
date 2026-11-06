drop function if exists public.get_sales_analysis_chart(date, date, text, uuid);
drop function if exists public.get_sales_analysis_price_lists();

update public.roles as target_role
set permissions = array_append(target_role.permissions, 'stock_checks.export')
where exists (
  select 1
  from rollback_archive.roles_stock_check_export_20261106090000 archived
  where archived.role_id = target_role.id
)
and not ('stock_checks.export' = any(target_role.permissions));

drop table if exists rollback_archive.roles_stock_check_export_20261106090000;
drop index if exists public.orders_price_list_created_at_idx;
