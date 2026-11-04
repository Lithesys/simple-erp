create policy "purchasing users can read current product costs"
on public.product_costs
for select
to authenticated
using ((select public.user_has_permission('purchases.manage')));
