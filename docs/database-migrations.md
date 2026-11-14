# Database migrations

Database changes live in timestamped files under `supabase/migrations/`. Each migration that changes remote schema must have a reviewed rollback script under `supabase/rollbacks/` before it is applied.

## Apply a migration

1. Inspect the migration and identify every table, policy, grant, function, trigger, role permission, and data change it affects.
2. Write the matching rollback script first. Restore replaced policies and grants to their exact previous definitions. For data changes, state what can be recovered and require an export or backup before destructive rollback.
3. Confirm the linked Supabase account and project ID, then inspect remote migration history and verify the target migration is not already applied. Do not apply unrelated pending migrations as a side effect.
4. Apply the single reviewed migration through the connected Supabase migration tool (or a migration-aware CLI workflow) so migration history stays in sync. If the tool records a generated version, rename the local migration and rollback files to that exact version before committing, then confirm local and remote histories match.
5. Verify the live catalog: expected columns and constraints, RLS enabled, policies and grants, functions and execute privileges, and any intended role permissions. Then verify the app contract separately; a source migration alone does not prove the remote schema changed.
6. Record the project, migration name, apply result, and catalog checks in the delivery notes. Never include credentials.

## Roll back a migration

1. Read the matching file in `supabase/rollbacks/` and identify data loss. Export affected rows or take a recoverable backup first when data must be preserved.
2. Do not edit or delete the already-applied migration. Create a new timestamped compensating migration with `supabase migration new rollback_<feature>` and copy in the reviewed rollback SQL.
3. Confirm that only this compensating migration is pending, apply it through the migration-aware workflow, and verify the schema and migration history afterward. A rollback script applied outside migration history can leave future deploys inconsistent.
4. Revert application code separately and verify the rolled-back app no longer expects the removed schema.

## Shared application settings

The migration `20261105044617_shared_app_settings.sql` creates `public.app_settings`, a generic JSONB key/value table, and seeds the public `store_name` setting with the default `ERP`. RLS allows public reads only for rows marked public and restricts all writes and private reads to `accounts.manage`. Explicit Data API grants are included. The rollback drops the table and all values added to it; export settings before using the rollback after deployment.

## Debt feature rollback

The prepared script is [20261010020929_plan_10_09_01_debts.sql](../supabase/rollbacks/20261010020929_plan_10_09_01_debts.sql). It removes the debt RPC/table, strips only the `debts.*` permissions, and restores the pre-feature `customers_read` policy. Dropping the table deletes all debt rows, so export them first if rollback occurs after users have created records.

## Stock check documents

If rolling back, apply the scripts in reverse migration order: [20261020032218_stock_check_rpc_table_policies.sql](../supabase/rollbacks/20261020032218_stock_check_rpc_table_policies.sql) removes the RPC-only policies and restores authenticated table grants, then [20261020032037_stock_check_documents.sql](../supabase/rollbacks/20261020032037_stock_check_documents.sql) removes stock-check documents, line snapshots, event history, and the movement link while leaving current product stock unchanged. Export all stock-check documents before rolling back the feature because its audit history is deleted.

## Debt type catalog rollback

The prepared script is [20261010035743_debt_item_catalog.sql](../supabase/rollbacks/20261010035743_debt_item_catalog.sql). It removes the type catalog and its ID relationship, then restores the previous `search_debts` RPC. Debt rows keep their text labels when a type is deleted, so historical detail survives deletion. Renaming a type updates linked debt labels too; export the catalog and affected debt rows before rollback if the earlier names must be recovered.

## Product Combo rollback

The prepared script is [20261010074000_product_combos.sql](../supabase/rollbacks/20261010074000_product_combos.sql). It first archives Combo definitions and sold-order component snapshots in the unexposed `rollback_archive` schema, then deactivates Combo products before removing the recipe tables and restoring the previous checkout, order edit/delete, and cost-snapshot functions. After rollback, editing or deleting orders that contain archived Combo products is blocked until their component definitions are restored, preventing inventory from being adjusted against the virtual Combo row. Keep the archive tables until Combo definitions and component history have been restored or intentionally retired. Product rows, prices, and physical inventory remain in place.

## Negative inventory checkout fix

The prepared rollback for [20261010081009_allow_negative_inventory_sales.sql](../supabase/rollbacks/20261010081009_allow_negative_inventory_sales.sql) restores the prior `checkout_order` implementation, including its stock check. Applying the fix changes only that function: it retains Combo component snapshots, stable inventory row locks, price/permission checks, and stock deductions while allowing direct products and Combo components to go below zero. It does not rewrite existing orders or stock. The regression test [negative_inventory_checkout.sql](../supabase/tests/negative_inventory_checkout.sql) checks both direct and Combo sales inside a transaction that rolls back its fixtures.

## Order cancellation and product reactivation

The migration [20261022100312_soft_cancel_orders_restore_products.sql](../migrations/20261022100312_soft_cancel_orders_restore_products.sql) adds the product status filter and reactivation RPC, converts order deletion RPCs to irreversible cancellation, and blocks hard deletes and reopening canceled orders. Cancellation restores sold quantities to stock and retains the order and item snapshots. The rollback [20261022100312_soft_cancel_orders_restore_products.sql](../rollbacks/20261022100312_soft_cancel_orders_restore_products.sql) restores hard-delete behavior; review the warning in that script before applying it.

## Order line editing

The migration [20261023073328_edit_order_line_management.sql](../migrations/20261023073328_edit_order_line_management.sql) lets `edit_order` receive the final set of order lines, so an authorized editor can add products, update quantities and prices, or remove lines. New products are checked against current catalog and combo data; additions require `products.read`. Inventory deltas, order-item snapshots, totals, and audit records are committed atomically while stock rows are locked in stable order. The rollback [20261023073328_edit_order_line_management.sql](../rollbacks/20261023073328_edit_order_line_management.sql) restores the previous RPC, which only updates and removes existing lines.

## Order edit price lists

The migration [20261029021914_order_edit_price_list.sql](../migrations/20261029021914_order_edit_price_list.sql) adds a seven-argument `edit_order` overload for selecting a price list while editing an invoice. When the list changes, the function locks and validates the active list and every product price, recalculates all existing and newly added lines from that list, and updates the order's price-list snapshot in the same transaction. It also lets users with `orders.edit` read active price lists and prices so the edit form can show the resulting prices. The six-argument RPC remains available for older clients. The rollback [20261029021914_order_edit_price_list.sql](../rollbacks/20261029021914_order_edit_price_list.sql) removes the new overload and the two read policies.

System settings are browser-local preferences under `erp-preference:system:v1:*`; they are scoped by signed-in user and must not be written through Supabase or another server endpoint. `In tự động` defaults to enabled and controls printing after a successful invoice edit.

## Order filtering by product ID

The migration [20261029014015_orders_filter_product_id.sql](../supabase/migrations/20261029014015_orders_filter_product_id.sql) adds an optional product ID to the filtered order page and summary RPCs. Product ID matches are ORed with the existing selected SKU matches; date, customer, invoice, and status filters continue to combine with AND. The rollback [20261029014015_orders_filter_product_id.sql](../supabase/rollbacks/20261029014015_orders_filter_product_id.sql) restores the previous function signatures and definitions.

## Order filtering by time

The migration [20261029041055_orders_filter_time_range.sql](../supabase/migrations/20261029041055_orders_filter_time_range.sql) adds backward-compatible page and summary RPC overloads with `from` and `to` time parameters. The lower bound is inclusive; the selected end minute is inclusive by converting it to an exclusive boundary one minute later. Both filters use `Asia/Ho_Chi_Minh` and apply before pagination. The rollback removes only the overloads with time parameters.

## Product analysis daily aggregates

The migration [20261028041339_product_analysis_daily_aggregates.sql](../supabase/migrations/20261028041339_product_analysis_daily_aggregates.sql) stores reversible per-order contributions and daily sales, cost, bought-together, and version rows. Order/item/cost triggers update the old and new day in the same transaction. The one-time backfill can be rerun; it replaces each order contribution rather than adding a second copy. The rollback [20261028041339_product_analysis_daily_aggregates.sql](../supabase/rollbacks/20261028041339_product_analysis_daily_aggregates.sql) drops only derived tables, triggers, and RPCs. Reapplying the feature reconstructs the aggregates from completed orders; no order source rows are deleted.

## Product detail sales charts

The migration [20261028075913_product_sales_stats_charts.sql](../supabase/migrations/20261028075913_product_sales_stats_charts.sql) extends `get_product_sales_summary` with daily quantity, line revenue, and gross-profit values for the product detail charts. It enforces product and order visibility, returns profit only to users with `products.cost.read`, and reuses the daily product-analysis profit aggregates. The rollback restores the previous summary RPC. The migration [20261028080024_product_sales_stats_product_index.sql](../supabase/migrations/20261028080024_product_sales_stats_product_index.sql) adds the covering product/order index used by the range query; its rollback removes only that index.

## Purchase creation cost overrides

The migration [20261023080531_purchase_create_cost_permission.sql](../supabase/migrations/20261023080531_purchase_create_cost_permission.sql) allows changing purchase unit costs while creating a pending purchase only when the actor has `purchases.create`, `purchases.update`, `purchases.approve`, and `products.cost.read`. The RPC replaces submitted costs with the current product cost for cost viewers without both edit and approval permissions, and with zero when cost is hidden. The rollback [20261023080531_purchase_create_cost_permission.sql](../supabase/rollbacks/20261023080531_purchase_create_cost_permission.sql) restores the prior create RPC behavior.

## Reading inactive products

The migration [20261023025527_products_read_inactive_products.sql](../migrations/20261023025527_products_read_inactive_products.sql) lets `products.read` users view inactive products while preserving the separate `products.archive` requirement for archiving and reactivation. The rollback [20261023025527_products_read_inactive_products.sql](../rollbacks/20261023025527_products_read_inactive_products.sql) restores the previous RLS policy. The regression test [products_read_inactive.sql](../tests/products_read_inactive.sql) verifies read access, status-filter results, and denied reactivation without the lifecycle permission.

## Negative inventory adjustments

The migration [20261110000000_allow_negative_inventory_adjustments.sql](../supabase/migrations/20261110000000_allow_negative_inventory_adjustments.sql) allows negative actual counts in stock-check documents, including direct product stock edits recorded by the inventory trigger. It also allows edits to received purchase orders to reduce stock below zero. Product stock already has no nonnegative database constraint; sales and received-purchase cancellation already allow negative balances. The migration does not rewrite existing stock balances.
