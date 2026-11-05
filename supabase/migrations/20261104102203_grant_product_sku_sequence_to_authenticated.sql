-- Product creation uses the SKU sequence through the PostgREST authenticated role.
-- Local PGlite databases do not inherit Supabase's managed default grants.
grant usage, select on sequence public.product_sku_seq to authenticated;
