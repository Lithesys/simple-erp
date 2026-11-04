-- Run with `supabase test db` after the product-analysis migration.
-- The outer transaction rolls back all fixture orders and trigger side effects.
begin;

do $$
declare
  v_scope_all uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_cashier_id uuid;
  v_other_cashier_id uuid;
  v_order_one uuid := gen_random_uuid();
  v_order_two uuid := gen_random_uuid();
  v_order_three uuid := gen_random_uuid();
  v_tea_line uuid := gen_random_uuid();
  v_coffee_line uuid := gen_random_uuid();
  v_combo_line uuid := gen_random_uuid();
  v_milk_line uuid := gen_random_uuid();
  v_missing_line uuid := gen_random_uuid();
  v_quantity numeric;
  v_revenue numeric;
  v_profit numeric;
  v_missing integer;
  v_pair_count integer;
  v_before numeric;
  v_after numeric;
  v_old_day_version bigint;
  v_after_old_day_version bigint;
  v_new_day_version bigint;
  v_before_new_day_version bigint;
  v_cancelled_day_version bigint;
begin
  select id into v_cashier_id from public.profiles order by id limit 1;
  select id into v_other_cashier_id from public.profiles
  where id <> v_cashier_id order by id limit 1;
  if v_cashier_id is null or v_other_cashier_id is null then
    raise exception 'Cần hai profile để kiểm tra phạm vi cashier';
  end if;

  insert into public.orders(id, idempotency_key, cashier_id, price_list_name, subtotal, discount, total, status, created_at)
  values
    (v_order_one, gen_random_uuid(), v_cashier_id, '', 600, 1, 599, 'completed', '2099-01-10 03:00:00+00'),
    (v_order_two, gen_random_uuid(), v_cashier_id, '', 1250, 0, 1250, 'completed', '2099-01-11 03:00:00+00'),
    (v_order_three, gen_random_uuid(), v_cashier_id, '', 100, 0, 100, 'completed', '2099-01-12 03:00:00+00');

  insert into public.order_items(id, order_id, product_name, sku, unit, quantity, unit_price, line_total, display_order)
  values
    (v_tea_line, v_order_one, 'REA trà xanh', 'REA-TEA', 'cái', 1.25, 100, 100, 0),
    (v_coffee_line, v_order_one, 'REA cà phê', 'REA-COFFEE', 'cái', 2, 100, 200, 1),
    (v_combo_line, v_order_one, 'REA Combo', 'REA-COMBO', 'combo', 0.5, 600, 300, 2),
    (v_milk_line, v_order_two, 'REA sữa', 'REA-MILK', 'hộp', 10, 120, 1200, 0),
    (gen_random_uuid(), v_order_two, 'REA Combo', 'REA-COMBO', 'combo', 0.5, 100, 50, 1),
    (v_missing_line, v_order_three, 'REA thiếu giá vốn', 'REA-MISSING', 'cái', 0.5, 200, 100, 0);

  update public.order_item_cost_snapshots set unit_cost = 20 where order_item_id = v_tea_line;
  update public.order_item_cost_snapshots set unit_cost = 40 where order_item_id = v_coffee_line;
  update public.order_item_cost_snapshots set unit_cost = 50 where order_item_id = v_combo_line;
  update public.order_item_cost_snapshots set unit_cost = 100 where order_item_id = v_milk_line;
  update public.order_item_cost_snapshots
    set unit_cost = 20
    where order_item_id in (
      select id from public.order_items where order_id = v_order_two and product_name = 'REA Combo'
    );
  delete from public.order_item_cost_snapshots where order_item_id = v_missing_line;

  select sum(quantity), sum(net_revenue)
  into v_quantity, v_revenue
  from public.product_analysis_daily_sales
  where scope_user_id = v_scope_all and business_date = date '2099-01-10';
  if v_quantity <> 3.75 or v_revenue <> 599 then
    raise exception 'Lẻ/Combo/chiết khấu sai: quantity %, revenue %', v_quantity, v_revenue;
  end if;

  select sum(gross_profit), sum(missing_cost_line_count)
  into v_profit, v_missing
  from public.product_analysis_daily_profit
  where scope_user_id = v_scope_all and business_date = date '2099-01-10';
  if v_profit <> 469 or v_missing <> 0 then
    raise exception 'Profit theo snapshot hoặc chia chiết khấu sai: %, missing %', v_profit, v_missing;
  end if;

  select sum(co_order_count)::integer into v_pair_count
  from public.product_analysis_daily_pairs
  where scope_user_id = v_scope_all and business_date = date '2099-01-10';
  if v_pair_count <> 3 then
    raise exception 'Mỗi cặp sản phẩm phải được đếm một lần mỗi đơn; nhận %', v_pair_count;
  end if;

  select sum(quantity) into v_quantity
  from public.product_analysis_daily_sales
  where scope_user_id = v_scope_all and business_date between date '2099-01-10' and date '2099-01-11';
  select sum(gross_profit) into v_profit
  from public.product_analysis_daily_profit
  where scope_user_id = v_scope_all and business_date between date '2099-01-10' and date '2099-01-11';
  if v_quantity <> 14.25 or v_profit <> 709 or v_profit / v_quantity <> 709::numeric / 14.25 then
    raise exception 'Tổng kỳ phải dùng tổng profit / tổng quantity: %, %, %', v_quantity, v_profit, v_profit / v_quantity;
  end if;

  select sum(missing_cost_line_count) into v_missing
  from public.product_analysis_daily_profit
  where scope_user_id = v_scope_all and business_date = date '2099-01-12';
  if v_missing <> 1 then
    raise exception 'Snapshot giá vốn thiếu phải được đánh dấu, nhận %', v_missing;
  end if;

  select quantity into v_before
  from public.product_analysis_order_products
  where order_id = v_order_one and product_key = 'name:rea trà xanh';
  perform public.refresh_product_analysis_order(v_order_one);
  perform public.refresh_product_analysis_order(v_order_one);
  select quantity into v_after
  from public.product_analysis_order_products
  where order_id = v_order_one and product_key = 'name:rea trà xanh';
  if v_before <> v_after then
    raise exception 'Backfill chạy lại đã nhân đôi đóng góp: trước %, sau %', v_before, v_after;
  end if;

  update public.order_items set quantity = 2 where id = v_tea_line;
  select quantity into v_after
  from public.product_analysis_order_products
  where order_id = v_order_one and product_key = 'name:rea trà xanh';
  if v_after <> 2 then raise exception 'Sửa quantity chưa thay đóng góp'; end if;

  select coalesce((
    select version from public.product_analysis_daily_versions
    where scope_user_id = v_scope_all and business_date = date '2099-01-11'
  ), 0) into v_old_day_version;
  select coalesce((
    select version from public.product_analysis_daily_versions
    where scope_user_id = v_scope_all and business_date = date '2099-01-13'
  ), 0) into v_before_new_day_version;
  update public.orders
  set created_at = '2099-01-13 03:00:00+00', cashier_id = v_other_cashier_id
  where id = v_order_two;
  select coalesce((
    select version from public.product_analysis_daily_versions
    where scope_user_id = v_scope_all and business_date = date '2099-01-11'
  ), 0) into v_after_old_day_version;
  select coalesce((
    select version from public.product_analysis_daily_versions
    where scope_user_id = v_scope_all and business_date = date '2099-01-13'
  ), 0) into v_new_day_version;
  if v_after_old_day_version <= v_old_day_version
     or v_new_day_version <= v_before_new_day_version then
    raise exception 'Đổi ngày phải tăng phiên bản ngày cũ và ngày mới';
  end if;
  if not exists (
    select 1 from public.product_analysis_order_products
    where order_id = v_order_two and business_date = date '2099-01-13' and cashier_id = v_other_cashier_id
  ) then
    raise exception 'Đổi ngày và người bán chưa chuyển đóng góp';
  end if;
  if coalesce((
    select sum(quantity) from public.product_analysis_daily_sales
    where scope_user_id = v_other_cashier_id and business_date = date '2099-01-13'
  ), 0) <> 10.5 then
    raise exception 'Đổi người bán chưa chuyển số liệu vào phạm vi cashier mới';
  end if;

  select version into v_cancelled_day_version
  from public.product_analysis_daily_versions
  where scope_user_id = v_scope_all and business_date = date '2099-01-13';
  update public.orders set status = 'cancelled' where id = v_order_two;
  select version into v_new_day_version
  from public.product_analysis_daily_versions
  where scope_user_id = v_scope_all and business_date = date '2099-01-13';
  if exists (select 1 from public.product_analysis_order_products where order_id = v_order_two)
     or exists (select 1 from public.product_analysis_order_pairs where order_id = v_order_two) then
    raise exception 'Hủy đơn chưa trừ đóng góp đã lưu';
  end if;
  if v_new_day_version <= v_cancelled_day_version then
    raise exception 'Hủy đơn ngày cũ chưa tăng phiên bản cache';
  end if;
end;
$$;

rollback;
