-- Restore the prior policy, which exposed inactive products only to lifecycle editors.
drop policy if exists "read products by permission" on public.products;
drop policy if exists "read active products" on public.products;

create policy "read active products" on public.products
for select to authenticated
using (
  (is_active and (
    public.user_has_permission('products.read') or
    public.user_has_permission('sales.create')
  )) or
  public.user_has_permission('products.update') or
  public.user_has_permission('products.archive')
);
