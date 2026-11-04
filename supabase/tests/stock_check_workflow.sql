-- Run against a migrated disposable database with an active Admin profile.
-- All fixtures are contained in a rolled-back subtransaction.
do $$
declare
  v_admin uuid;
  v_product uuid;
  v_check_id uuid;
  v_auto_check_id uuid;
  v_before numeric;
begin
  select p.id into v_admin
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.is_active and r.name = 'Admin' limit 1;
  if v_admin is null then raise exception 'An active Admin profile is required'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  begin
    insert into public.products(sku, name, unit, stock)
    values ('__stock_check_' || gen_random_uuid()::text, '__stock_check_fixture__', 'cái', 10)
    returning id into v_product;

    -- Existing direct stock edits now produce a completed one-line document.
    update public.products set stock = 15 where id = v_product;
    select stock_check_id into v_auto_check_id from public.inventory_movements
    where product_id = v_product and stock_check_id is not null order by created_at desc limit 1;
    if v_auto_check_id is null or not exists (
      select 1 from public.stock_check_items where stock_check_id = v_auto_check_id
        and stock_before = 10 and actual_stock = 15 and applied_delta = 5
    ) then raise exception 'Direct product stock edit did not create its linked stock check'; end if;

    -- Completing a check applies the counted delta to the current stock.
    v_check_id := public.save_stock_check(null, 'workflow test',
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'actual_stock', 12)),
      'complete', gen_random_uuid());
    if (select stock from public.products where id = v_product) <> 12 then
      raise exception 'Completing the stock check did not apply its delta';
    end if;

    -- A later transaction is preserved when the original count is corrected.
    update public.products set stock = 20 where id = v_product;
    perform public.save_stock_check(v_check_id, 'corrected',
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'actual_stock', 13)),
      'complete', gen_random_uuid());
    if (select stock from public.products where id = v_product) <> 21 then
      raise exception 'Editing a completed check overwrote a later stock movement';
    end if;

    perform public.cancel_stock_check(v_check_id, gen_random_uuid());
    if (select stock from public.products where id = v_product) <> 23 then
      raise exception 'Cancelling a check did not reverse only its applied delta';
    end if;

    -- Draft creation/deletion never changes product stock.
    v_before := (select stock from public.products where id = v_product);
    v_check_id := public.save_stock_check(null, 'draft test', '[]'::jsonb, 'draft', gen_random_uuid());
    perform public.delete_stock_check(v_check_id, gen_random_uuid());
    if (select stock from public.products where id = v_product) <> v_before then
      raise exception 'Saving or deleting a draft changed product stock';
    end if;

    raise exception '__rollback_stock_check_fixtures__';
  exception when others then
    if sqlerrm <> '__rollback_stock_check_fixtures__' then raise; end if;
  end;
end $$;
