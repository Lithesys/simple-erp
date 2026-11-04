-- Removes only derived product-analysis data and its maintenance/query contract.
-- Source orders and order lines are unchanged. Reapplying the feature reruns its
-- idempotent backfill to reconstruct every aggregate from completed orders.

drop trigger if exists product_analysis_orders_after_change on public.orders;
drop trigger if exists product_analysis_order_items_after_change on public.order_items;
drop trigger if exists product_analysis_cost_snapshots_after_change on public.order_item_cost_snapshots;
drop trigger if exists product_analysis_catalog_after_change on public.products;

drop function if exists public.refresh_product_analysis_after_order_change();
drop function if exists public.refresh_product_analysis_after_item_change();
drop function if exists public.refresh_product_analysis_after_cost_change();
drop function if exists public.refresh_product_analysis_after_catalog_change();
drop function if exists public.refresh_product_analysis_order(uuid);
drop function if exists public.apply_product_analysis_sales_delta(uuid, date, text, uuid, text, numeric, numeric);
drop function if exists public.apply_product_analysis_profit_delta(uuid, date, text, numeric, integer, integer);
drop function if exists public.apply_product_analysis_pair_delta(uuid, date, text, uuid, text, text, uuid, text, integer);
drop function if exists public.bump_product_analysis_version(date, uuid);
drop function if exists public.bump_product_analysis_catalog_version(uuid);
drop function if exists public.get_product_analysis_metric_days(text, date, date, jsonb);
drop function if exists public.get_product_analysis_products(date, date, text, text, text, integer, integer, boolean, jsonb, bigint);
drop function if exists public.get_product_analysis_combos(date, date, jsonb, bigint);

drop table if exists public.product_analysis_order_products;
drop table if exists public.product_analysis_order_pairs;
drop table if exists public.product_analysis_daily_sales;
drop table if exists public.product_analysis_daily_profit;
drop table if exists public.product_analysis_daily_pairs;
drop table if exists public.product_analysis_daily_versions;
drop table if exists public.product_analysis_catalog_versions;
