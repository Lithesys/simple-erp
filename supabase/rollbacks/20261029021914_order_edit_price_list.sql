drop policy if exists "read active prices for order edit" on public.product_prices;
drop policy if exists "read active price lists for order edit" on public.price_lists;
drop function if exists public.edit_order(uuid, jsonb, numeric, text, text, text, uuid);
