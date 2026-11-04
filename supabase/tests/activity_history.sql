-- Run against a migrated disposable database with active Admin and Bán hàng profiles.
-- The synthetic product, price, order, stock movement, and audit rows roll back together.
do $$
declare
  v_admin uuid;
  v_employee uuid;
  v_product uuid;
  v_price_list uuid;
  v_order uuid;
  v_order_no text;
  v_sku text := '__activity_history_' || gen_random_uuid()::text;
  v_initial_audit_count integer;
  v_payload jsonb;
  v_operation jsonb;
  v_product_operation jsonb;
  v_first_page jsonb;
  v_repeat_page jsonb;
  v_second_page jsonb;
  v_first_ids text[];
  v_second_ids text[];
begin
  select p.id into v_admin
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.is_active and r.name = 'Admin' limit 1;
  select p.id into v_employee
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.is_active and r.name = 'Bán hàng' limit 1;
  if v_admin is null or v_employee is null then
    raise exception 'Active Admin and Bán hàng profiles are required';
  end if;
  if has_table_privilege('authenticated', 'public.activity_history', 'insert')
    or has_table_privilege('authenticated', 'public.activity_history', 'update')
    or has_table_privilege('authenticated', 'public.activity_history', 'delete') then
    raise exception 'Authenticated clients must not mutate activity history';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  if not public.user_has_permission('activity_history.read') then
    raise exception 'Admin must be able to read activity history';
  end if;

  begin
    insert into public.products(sku, name, unit, stock)
    values (v_sku, 'History fixture before', 'cái', 10)
    returning id into v_product;

    select count(*) into v_initial_audit_count
    from public.activity_history
    where entity_type = 'products' and entity_id = v_product::text;
    if v_initial_audit_count <> 1 then
      raise exception 'Product creation must create one history entry';
    end if;

    update public.products set name = name where id = v_product;
    if (select count(*) from public.activity_history
        where entity_type = 'products' and entity_id = v_product::text) <> v_initial_audit_count then
      raise exception 'Unchanged updates must not create history';
    end if;

    update public.products set name = 'History fixture after' where id = v_product;
    if not exists (
      select 1 from public.activity_history h
      where h.entity_type = 'products' and h.entity_id = v_product::text
        and h.changed_fields->'name'->>'before' = 'History fixture before'
        and h.changed_fields->'name'->>'after' = 'History fixture after'
    ) then
      raise exception 'Product name change must preserve database before/after values';
    end if;

    select id into v_price_list from public.price_lists where is_active limit 1;
    insert into public.product_prices(product_id, price_list_id, price)
    values (v_product, v_price_list, 1000);
    update public.product_prices set price = 1200 where product_id = v_product and price_list_id = v_price_list;
    if not exists (
      select 1 from public.activity_history h
      where h.entity_type = 'product_prices' and h.entity_id = v_product::text
        and h.changed_fields->'price'->'before' = '1000'::jsonb
        and h.changed_fields->'price'->'after' = '1200'::jsonb
    ) then
      raise exception 'Price changes must preserve before/after values';
    end if;

    update public.products set stock = 13 where id = v_product;
    if not exists (
      select 1 from public.activity_history h
      where h.action = 'Điều chỉnh tồn kho'
        and h.entity_id = v_product::text
        and h.changed_fields->'stock'->'before' = '10'::jsonb
        and h.changed_fields->'stock'->'after' = '13'::jsonb
    ) then
      raise exception 'Stock check-backed direct adjustments must use the adjustment label';
    end if;

    insert into public.orders(
      idempotency_key, cashier_id, price_list_id, price_list_name,
      customer_name, subtotal, discount, total
    ) values (
      gen_random_uuid(), v_admin, v_price_list, 'Activity history fixture',
      'Activity history fixture', 3000, 0, 3000
    ) returning id, order_no into v_order, v_order_no;
    insert into public.order_items(
      order_id, product_id, sku, product_name, unit, quantity, unit_price, line_total, display_order
    )
    values
      (v_order, v_product, v_sku, 'History fixture after', 'cái', 2, 1000, 2000, 0),
      (v_order, v_product, v_sku, 'History fixture after', 'cái', 1, 1000, 1000, 1);
    update public.order_items set quantity = 4, line_total = 4000
    where order_id = v_order and quantity = 2;

    v_payload := public.get_activity_history(null, null, v_order_no, v_admin, 'Đơn hàng', null, 20, 0, 'occurred_at', 'desc');
    select item.row into v_operation
    from jsonb_array_elements(v_payload->'rows') as item(row)
    where item.row->>'operation_id' = pg_current_xact_id()::text;
    if v_operation is null then
      raise exception 'Related order header and line entries must form one operation';
    end if;
    if (select count(*) from jsonb_array_elements(v_operation->'details') as item(row)
        where item.row->>'entity_type' = 'order_items') < 3 then
      raise exception 'Each changed order product line must remain individually visible';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_operation->'details') as item(row)
      where item.row->>'entity_type' = 'order_items'
        and item.row->'changed_fields'->'quantity'->'before' = '2'::jsonb
        and item.row->'changed_fields'->'quantity'->'after' = '4'::jsonb
    ) then
      raise exception 'Order line changes must include old and new quantities';
    end if;

    v_payload := public.get_activity_history(null, null, v_sku, v_admin, 'Hàng hóa', null, 20, 0, 'occurred_at', 'desc');
    select item.row into v_product_operation
    from jsonb_array_elements(v_payload->'rows') as item(row)
    where item.row->>'operation_id' = pg_current_xact_id()::text;
    if v_product_operation is null or jsonb_array_length(v_product_operation->'details') < 4 then
      raise exception 'Related product, price, and stock changes must share one operation';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_product_operation->'details') as item(row)
      where item.row->>'entity_type' = 'product_prices'
        and item.row->>'product_name' = 'History fixture after'
    ) then
      raise exception 'Price history details must include the product name snapshot';
    end if;

    raise exception '__rollback_activity_history_fixtures__';
  exception when others then
    if sqlerrm <> '__rollback_activity_history_fixtures__' then raise; end if;
  end;

  if exists (select 1 from public.products where sku = v_sku)
    or exists (select 1 from public.activity_history where entity_id = v_product::text) then
    raise exception 'Activity history test fixtures were not rolled back';
  end if;

  perform set_config('request.jwt.claim.sub', v_employee::text, true);
  if public.user_has_permission('activity_history.read')
    or (public.get_activity_history(null, null, '', null, null, null, 20, 0, 'occurred_at', 'desc')->>'total')::integer <> 0 then
    raise exception 'Bán hàng must not read activity history';
  end if;

  -- Existing operations use transaction IDs and a stable timestamp/id tie-breaker.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_first_page := public.get_activity_history(null, null, '', null, null, null, 2, 0, 'occurred_at', 'desc');
  v_repeat_page := public.get_activity_history(null, null, '', null, null, null, 2, 0, 'occurred_at', 'desc');
  v_second_page := public.get_activity_history(null, null, '', null, null, null, 2, 2, 'occurred_at', 'desc');
  if v_first_page->'rows' is distinct from v_repeat_page->'rows' then
    raise exception 'Repeated activity pages must have stable ordering';
  end if;
  select array_agg(item.row->>'operation_id' order by item.ordinality) into v_first_ids
  from jsonb_array_elements(v_first_page->'rows') with ordinality as item(row, ordinality);
  select array_agg(item.row->>'operation_id' order by item.ordinality) into v_second_ids
  from jsonb_array_elements(v_second_page->'rows') with ordinality as item(row, ordinality);
  if v_first_ids && v_second_ids then
    raise exception 'Adjacent activity pages must not overlap';
  end if;
end
$$;
