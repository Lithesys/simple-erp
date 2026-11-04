-- Run against a migrated disposable database with an active Admin profile.
-- All fixtures and activity/inventory history changes are contained in a rolled-back subtransaction.
do $$
declare
  v_admin uuid;
  v_list uuid;
  v_product uuid;
  v_order_id uuid;
  v_result jsonb;
  v_stock numeric;
  v_status text;
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
    values ('__order_cancel_' || gen_random_uuid()::text, '__order_cancel_fixture__', 10)
    returning id into v_product;
    insert into public.product_prices(product_id, price_list_id, price)
    values (v_product, v_list, 1000);

    v_result := public.checkout_order(
      gen_random_uuid(), v_list, 'Order cancellation regression', 0,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'quantity', 2, 'expected_price', 1000
      ))
    );
    v_order_id := (v_result->>'order_id')::uuid;
    if (select stock from public.products where id = v_product) <> 8 then
      raise exception 'Checkout fixture did not deduct inventory';
    end if;

    perform public.cancel_order(v_order_id);
    select stock into v_stock from public.products where id = v_product;
    select status into v_status from public.orders where id = v_order_id;
    if v_stock <> 10 then raise exception 'Cancellation did not restore the sold quantity'; end if;
    if v_status <> 'cancelled' then raise exception 'Canceled order was not retained with cancelled status'; end if;
    if (select count(*) from public.order_items where order_id = v_order_id) <> 1 then
      raise exception 'Cancellation removed the order item';
    end if;
    if not exists (
      select 1 from public.inventory_movements
      where order_id = v_order_id and product_id = v_product
        and quantity_change = 2 and reason = 'Hủy đơn hàng'
    ) then raise exception 'Cancellation inventory history was not recorded'; end if;

    begin
      perform public.cancel_order(v_order_id);
      raise exception '__expected_repeat_cancel_rejection__';
    exception when others then
      if sqlerrm = '__expected_repeat_cancel_rejection__' then raise; end if;
    end;

    begin
      update public.orders set status = 'completed' where id = v_order_id;
      raise exception '__expected_reactivation_rejection__';
    exception when others then
      if sqlerrm = '__expected_reactivation_rejection__' then raise; end if;
    end;
    begin
      delete from public.orders where id = v_order_id;
      raise exception '__expected_hard_delete_rejection__';
    exception when others then
      if sqlerrm = '__expected_hard_delete_rejection__' then raise; end if;
    end;
    if not exists (select 1 from public.orders where id = v_order_id and status = 'cancelled') then
      raise exception 'Canceled order did not survive rejected state changes';
    end if;

    perform public.archive_product(v_product);
    if (select is_active from public.products where id = v_product) then
      raise exception 'Archive RPC did not mark the product inactive';
    end if;
    perform public.reactivate_product(v_product);
    if not (select is_active from public.products where id = v_product) then
      raise exception 'Reactivation RPC did not mark the product active';
    end if;

    raise exception '__rollback_order_lifecycle_fixtures__';
  exception when others then
    if sqlerrm <> '__rollback_order_lifecycle_fixtures__' then raise; end if;
  end;
end $$;
