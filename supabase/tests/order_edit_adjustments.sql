-- Run against a migrated disposable database with an active Admin profile.
-- All fixtures are contained in a rolled-back subtransaction.
do $$
declare
  v_admin uuid;
  v_list uuid;
  v_product uuid;
  v_order_id uuid;
  v_result jsonb;
begin
  select p.id into v_admin
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.is_active and r.name = 'Admin'
  limit 1;
  if v_admin is null then raise exception 'An active Admin profile is required'; end if;
  select id into v_list from public.price_lists where is_active limit 1;
  if v_list is null then raise exception 'An active price list is required'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  begin
    insert into public.products(sku, name, stock)
    values ('__order_edit_' || gen_random_uuid()::text, '__order_edit_fixture__', 0)
    returning id into v_product;
    insert into public.product_prices(product_id, price_list_id, price)
    values (v_product, v_list, 1000);

    v_result := public.checkout_order(
      gen_random_uuid(), v_list, 'Order edit adjustment regression', 0,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'quantity', 1, 'expected_price', 1000
      ))
    );
    v_order_id := (v_result->>'order_id')::uuid;

    v_result := public.edit_order(
      v_order_id,
      (select jsonb_agg(jsonb_build_object(
        'id', oi.id, 'quantity', 2, 'unit_price', 2500
      )) from public.order_items oi where oi.order_id = v_order_id),
      0, 'Order edit adjustment regression', '', ''
    );

    if (select stock from public.products where id = v_product) <> -2 then
      raise exception 'Order edit should allow inventory to drop below zero';
    end if;
    if not exists (
      select 1 from public.order_items
      where order_id = v_order_id and product_id = v_product
        and quantity = 2 and unit_price = 2500 and line_total = 5000
    ) then
      raise exception 'Order edit should save the edited quantity and unit price';
    end if;
    if (select subtotal from public.orders where id = v_order_id) <> 5000
      or (select total from public.orders where id = v_order_id) <> 5000 then
      raise exception 'Order edit should recalculate order totals from the edited unit price';
    end if;

    raise exception '__rollback_order_edit_fixtures__';
  exception when others then
    if sqlerrm <> '__rollback_order_edit_fixtures__' then raise; end if;
  end;
end $$;
