-- Rollback for 20261022031805_activity_history.sql.
-- This removes all history recorded since deployment. Export those rows before applying this rollback.
begin;

drop trigger if exists activity_inventory_adjustment on public.inventory_movements;
drop trigger if exists activity_products on public.products;
drop trigger if exists activity_product_prices on public.product_prices;
drop trigger if exists activity_product_costs on public.product_costs;
drop trigger if exists activity_product_bundle_items on public.product_bundle_items;
drop trigger if exists activity_orders on public.orders;
drop trigger if exists activity_order_items on public.order_items;
drop trigger if exists activity_purchase_orders on public.purchase_orders;
drop trigger if exists activity_purchase_order_items on public.purchase_order_items;
drop trigger if exists activity_debts on public.debts;

drop function if exists public.get_activity_history(date, date, text, uuid, text, text, integer, integer, text, text);
drop function if exists public.get_activity_history_employees();
drop function if exists public.log_inventory_adjustment();
drop function if exists public.log_activity_change();
drop trigger if exists activity_history_immutable on public.activity_history;
drop function if exists public.prevent_activity_history_mutation();

update public.roles r
set permissions = array(
  select permission from unnest(coalesce(r.permissions, array[]::text[])) as permission
  where permission <> 'activity_history.read'
)
where 'activity_history.read' = any(coalesce(r.permissions, array[]::text[]));

drop table if exists public.activity_history;

commit;
