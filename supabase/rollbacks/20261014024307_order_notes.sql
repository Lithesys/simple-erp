-- Export order notes before running this rollback; dropping the column deletes them.
drop function if exists public.checkout_order(uuid, uuid, text, numeric, jsonb, text, text, text);

alter table public.orders
  drop column if exists note;
