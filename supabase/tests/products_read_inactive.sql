-- Run against a migrated disposable database with an active Employee profile.
-- Fixtures and permission edits are contained in a rolled-back subtransaction.
do $$
declare
  v_user uuid;
  v_test_role uuid;
  v_product uuid;
  v_result jsonb;
  v_count integer;
  v_sku text := '__products_read_inactive_' || gen_random_uuid()::text;
begin
  select p.id into v_user
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.is_active
    and 'products.read' = any(r.permissions)
    and not ('accounts.manage' = any(r.permissions))
  limit 1;
  if v_user is null then
    raise exception 'An active non-admin profile with products.read is required';
  end if;

  begin
    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    insert into public.roles(name, description, permissions)
    values (
      v_sku,
      'Inactive-product visibility regression fixture',
      array['products.read']::text[]
    )
    returning id into v_test_role;
    update public.profiles set role_id = v_test_role where id = v_user;

    insert into public.products(sku, name, stock, is_active)
    values (v_sku, 'Inactive product visibility fixture', 0, false)
    returning id into v_product;

    perform set_config('request.jwt.claim.sub', v_user::text, true);
    execute 'set local role authenticated';

    select count(*) into v_count
    from public.products
    where id = v_product;
    if v_count <> 1 then
      raise exception 'products.read could not read an inactive product';
    end if;

    v_result := public.get_products_page(
      p_query := v_sku,
      p_status_filter := 'inactive'
    );
    if not exists (
      select 1
      from jsonb_array_elements_text(v_result->'ids') as product_ids(product_id)
      where product_ids.product_id = v_product::text
    ) then
      raise exception 'The inactive products page omitted a readable product';
    end if;

    begin
      perform public.reactivate_product(v_product);
      raise exception '__expected_reactivation_permission_denial__';
    exception when sqlstate '42501' then
      null;
    end;

    execute 'reset role';
    update public.roles set permissions = array[]::text[] where id = v_test_role;
    execute 'set local role authenticated';
    select count(*) into v_count
    from public.products
    where id = v_product;
    if v_count <> 0 then
      raise exception 'A user without products.read could read an inactive product';
    end if;
    execute 'reset role';

    raise exception '__rollback_products_read_inactive_fixture__';
  exception when others then
    if sqlerrm <> '__rollback_products_read_inactive_fixture__' then raise; end if;
  end;
end $$;
