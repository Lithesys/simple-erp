-- A product reader can inspect archived products without gaining lifecycle write access.
drop policy if exists "read active products" on public.products;
drop policy if exists "read products by permission" on public.products;

create policy "read products by permission" on public.products
for select to authenticated
using (
  public.user_has_permission('products.read') or
  (is_active and public.user_has_permission('sales.create')) or
  public.user_has_permission('products.update') or
  public.user_has_permission('products.archive')
);
