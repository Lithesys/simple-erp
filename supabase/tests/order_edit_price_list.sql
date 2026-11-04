-- Run against a migrated database with an active Admin profile.
-- Fixtures are contained in a rolled-back subtransaction.
do $$
declare
  v_admin uuid;
  v_original_list uuid;
  v_new_list uuid;
  v_incomplete_list uuid;
  v_product_one uuid;
  v_product_two uuid;
  v_product_three uuid;
  v_order_id uuid;
  v_lines jsonb;
  v_result jsonb;
  v_rejected boolean := false;
begin
  select p.id into v_admin
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.is_active and r.name = 'Admin'
  limit 1;
  if v_admin is null then raise exception 'An active Admin profile is required'; end if;
  select id into v_original_list from public.price_lists where is_active limit 1;
  if v_original_list is null then raise exception 'An active price list is required'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  begin
    insert into public.price_lists(name, is_active)
    values ('__order_edit_price_list_' || gen_random_uuid()::text, true)
    returning id into v_new_list;
    insert into public.price_lists(name, is_active)
    values ('__order_edit_incomplete_list_' || gen_random_uuid()::text, true)
    returning id into v_incomplete_list;

    insert into public.products(sku, name, stock)
    values ('__edit_price_one_' || gen_random_uuid()::text, 'Price list fixture one', 0)
    returning id into v_product_one;
    insert into public.products(sku, name, stock)
    values ('__edit_price_two_' || gen_random_uuid()::text, 'Price list fixture two', 0)
    returning id into v_product_two;
    insert into public.products(sku, name, stock)
    values ('__edit_price_three_' || gen_random_uuid()::text, 'Price list fixture three', 0)
    returning id into v_product_three;

    insert into public.product_prices(product_id, price_list_id, price)
    values
      (v_product_one, v_original_list, 1000),
      (v_product_two, v_original_list, 500),
      (v_product_one, v_new_list, 2000),
      (v_product_two, v_new_list, 700),
      (v_product_three, v_original_list, 300),
      (v_product_three, v_new_list, 400),
      (v_product_one, v_incomplete_list, 9000);

    v_result := public.checkout_order(
      gen_random_uuid(), v_original_list, 'Price list edit regression', 100,
      jsonb_build_array(
        jsonb_build_object('product_id', v_product_one, 'quantity', 2, 'expected_price', 1000),
        jsonb_build_object('product_id', v_product_two, 'quantity', 1, 'expected_price', 500)
      )
    );
    v_order_id := (v_result->>'order_id')::uuid;

    v_lines := (select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'quantity', item.quantity,
        'unit_price', item.unit_price
      ) order by item.display_order) from public.order_items item where item.order_id = v_order_id)
      || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_three, 'quantity', 3, 'unit_price', 1
      ));
    v_result := public.edit_order(
      v_order_id,
      v_lines,
      100, 'Price list edit regression', '', '', v_new_list
    );

    if (select price_list_id from public.orders where id = v_order_id) <> v_new_list
      or (select price_list_name from public.orders where id = v_order_id) <>
        (select name from public.price_lists where id = v_new_list) then
      raise exception 'Order should store the selected price list and its name';
    end if;
    if (select unit_price from public.order_items where order_id = v_order_id and product_id = v_product_one) <> 2000
      or (select unit_price from public.order_items where order_id = v_order_id and product_id = v_product_two) <> 700 then
      raise exception 'Every existing order line should use its selected price list price';
    end if;
    if (select unit_price from public.order_items where order_id = v_order_id and product_id = v_product_three) <> 400 then
      raise exception 'New order lines should use the selected price list price';
    end if;
    if (select subtotal from public.orders where id = v_order_id) <> 5900
      or (select total from public.orders where id = v_order_id) <> 5800
      or (v_result->>'total')::numeric <> 5800 then
      raise exception 'The order totals should use the selected price list prices';
    end if;

    begin
      perform public.edit_order(
        v_order_id,
        (select jsonb_agg(jsonb_build_object(
          'id', item.id,
          'quantity', item.quantity,
          'unit_price', item.unit_price
        ) order by item.display_order) from public.order_items item where item.order_id = v_order_id),
        100, 'Price list edit regression', '', '', v_incomplete_list
      );
    exception when others then
      if sqlerrm not like 'Bảng giá chưa có giá%' then raise; end if;
      v_rejected := true;
    end;
    if not v_rejected then raise exception 'An incomplete price list should be rejected'; end if;
    if (select price_list_id from public.orders where id = v_order_id) <> v_new_list
      or (select subtotal from public.orders where id = v_order_id) <> 5900 then
      raise exception 'A rejected price list change must leave the order unchanged';
    end if;

    raise exception '__rollback_order_edit_price_list_fixtures__';
  exception when others then
    if sqlerrm <> '__rollback_order_edit_price_list_fixtures__' then raise; end if;
  end;
end $$;
