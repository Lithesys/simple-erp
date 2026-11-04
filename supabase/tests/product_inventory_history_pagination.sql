-- Run against a migrated disposable database with an active Admin profile.
-- Synthetic product and movements are rolled back with the subtransaction.
do $$
declare
  v_admin uuid;
  v_product uuid;
  v_page_one jsonb;
  v_page_one_repeat jsonb;
  v_page_two jsonb;
  v_date_page jsonb;
  v_ids_one text[];
  v_ids_two text[];
begin
  select p.id into v_admin
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.is_active and r.name = 'Admin'
  limit 1;
  if v_admin is null then raise exception 'An active Admin profile is required'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  begin
    insert into public.products(sku, name, unit, stock)
    values ('__inventory_history_page_' || gen_random_uuid()::text, '__inventory_history_page__', 'cái', 45)
    returning id into v_product;

    insert into public.inventory_movements(product_id, quantity_change, reason, actor_id, created_at)
    select v_product, 1, 'pagination fixture', v_admin,
      case when n <= 25 then '2026-10-20 16:30:00+00'::timestamptz
        else '2026-10-20 17:30:00+00'::timestamptz end
    from generate_series(1, 45) n;

    v_page_one := public.get_product_inventory_history_page(v_product, 1, 10);
    v_page_one_repeat := public.get_product_inventory_history_page(v_product, 1, 10);
    v_page_two := public.get_product_inventory_history_page(v_product, 2, 10);
    select array_agg(item->>'id' order by ordinal)
    into v_ids_one
    from jsonb_array_elements(v_page_one->'rows') with ordinality as rows(item, ordinal);
    select array_agg(item->>'id' order by ordinal)
    into v_ids_two
    from jsonb_array_elements(v_page_two->'rows') with ordinality as rows(item, ordinal);

    if v_page_one->>'total' <> '45'
      or jsonb_array_length(v_page_one->'rows') <> 10
      or coalesce((v_page_one->>'quantity_change_total')::numeric, 0) <> 45 then
      raise exception 'First page must include API pagination metadata and complete totals';
    end if;
    if v_ids_one is distinct from (
      select array_agg(item->>'id' order by ordinal)
      from jsonb_array_elements(v_page_one_repeat->'rows') with ordinality as rows(item, ordinal)
    ) then
      raise exception 'Repeated requests must return a stable page';
    end if;
    if v_ids_one && v_ids_two then
      raise exception 'Adjacent pages must not contain duplicate movement ids';
    end if;

    v_date_page := public.get_product_inventory_history_page(
      v_product, 1, 10, '2026-10-21'::date, '2026-10-21'::date
    );
    if v_date_page->>'total' <> '20'
      or coalesce((v_date_page->>'quantity_change_total')::numeric, 0) <> 20 then
      raise exception 'Date filters must use the application timezone and summarize all matching rows';
    end if;

    raise exception '__rollback_inventory_history_page_fixtures__';
  exception when others then
    if sqlerrm <> '__rollback_inventory_history_page_fixtures__' then raise; end if;
  end;
end;
$$;
