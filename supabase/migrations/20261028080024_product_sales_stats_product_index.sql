-- Support product-specific sales history scans and the product_id foreign key.
create index if not exists order_items_product_sales_stats_idx
  on public.order_items (product_id, order_id)
  include (quantity, line_total);
