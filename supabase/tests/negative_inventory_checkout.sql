-- Run against a migrated database with an active Admin profile. The exception subtransaction rolls back every fixture write.
do $$
declare
  v_admin uuid;
  v_list uuid;
  v_product uuid;
  v_component uuid;
  v_combo uuid;
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
    values ('__negative_sale_' || gen_random_uuid()::text, '__negative_sale_product__', 0)
    returning id into v_product;
    insert into public.products(sku, name, stock)
    values ('__negative_component_' || gen_random_uuid()::text, '__negative_component__', 0)
    returning id into v_component;
    insert into public.products(sku, name, stock, kind)
    values ('__negative_combo_' || gen_random_uuid()::text, '__negative_combo__', 0, 'combo')
    returning id into v_combo;
    insert into public.product_prices(product_id, price_list_id, price)
    values (v_product, v_list, 1000), (v_combo, v_list, 5000);
    insert into public.product_bundle_items(bundle_product_id, product_id, quantity_per_bundle)
    values (v_combo, v_component, 2);

    v_result := public.checkout_order(
      gen_random_uuid(), v_list, 'Negative stock regression', 0,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1, 'expected_price', 1000))
    );
    if v_result->>'order_no' is null then raise exception 'Direct sale did not create an order'; end if;
    if (select stock from public.products where id = v_product) <> -1 then
      raise exception 'Direct sale should allow stock to become negative';
    end if;

    v_result := public.checkout_order(
      gen_random_uuid(), v_list, 'Negative combo stock regression', 0,
      jsonb_build_array(jsonb_build_object('product_id', v_combo, 'quantity', 1, 'expected_price', 5000))
    );
    if v_result->>'order_no' is null then raise exception 'Combo sale did not create an order'; end if;
    if (select stock from public.products where id = v_component) <> -2 then
      raise exception 'Combo sale should allow component stock to become negative';
    end if;

    -- Force the successful test fixtures to roll back before leaving this subtransaction.
    raise exception '__rollback_test_fixtures__';
  exception when others then
    if sqlerrm <> '__rollback_test_fixtures__' then raise; end if;
  end;
end $$;
