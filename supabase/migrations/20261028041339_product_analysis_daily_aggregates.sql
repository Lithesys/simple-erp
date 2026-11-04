-- Incremental, permission-scoped aggregates for the product analysis page.
-- The order-level rows are the reversible source of each daily contribution.

create table public.product_analysis_order_products (
  order_id uuid not null references public.orders(id) on delete cascade,
  business_date date not null,
  cashier_id uuid,
  product_key text not null,
  product_id uuid,
  product_name text not null,
  quantity numeric not null,
  net_revenue numeric not null,
  gross_profit numeric not null,
  missing_cost_line_count integer not null,
  line_count integer not null,
  primary key (order_id, product_key),
  check (quantity > 0),
  check (net_revenue >= 0),
  check (missing_cost_line_count >= 0),
  check (line_count > 0)
);

create index product_analysis_order_products_order_idx
  on public.product_analysis_order_products(order_id);

create table public.product_analysis_order_pairs (
  order_id uuid not null references public.orders(id) on delete cascade,
  business_date date not null,
  cashier_id uuid,
  first_product_key text not null,
  first_product_id uuid,
  first_product_name text not null,
  second_product_key text not null,
  second_product_id uuid,
  second_product_name text not null,
  primary key (order_id, first_product_key, second_product_key),
  check (first_product_key < second_product_key)
);

create index product_analysis_order_pairs_order_idx
  on public.product_analysis_order_pairs(order_id);

create table public.product_analysis_daily_sales (
  scope_user_id uuid not null,
  business_date date not null,
  product_key text not null,
  product_id uuid,
  product_name text not null,
  quantity numeric not null,
  net_revenue numeric not null,
  primary key (scope_user_id, business_date, product_key),
  check (quantity >= 0),
  check (net_revenue >= 0)
);

create index product_analysis_daily_sales_product_idx
  on public.product_analysis_daily_sales(scope_user_id, product_id, business_date)
  include (quantity, net_revenue);

create table public.product_analysis_daily_profit (
  scope_user_id uuid not null,
  business_date date not null,
  product_key text not null,
  gross_profit numeric not null,
  missing_cost_line_count integer not null,
  primary key (scope_user_id, business_date, product_key),
  check (missing_cost_line_count >= 0)
);

create table public.product_analysis_daily_pairs (
  scope_user_id uuid not null,
  business_date date not null,
  first_product_key text not null,
  first_product_id uuid,
  first_product_name text not null,
  second_product_key text not null,
  second_product_id uuid,
  second_product_name text not null,
  co_order_count integer not null,
  primary key (scope_user_id, business_date, first_product_key, second_product_key),
  check (first_product_key < second_product_key),
  check (co_order_count >= 0)
);

create index product_analysis_daily_pairs_product_idx
  on public.product_analysis_daily_pairs(scope_user_id, business_date, first_product_id, second_product_id)
  include (co_order_count);

create table public.product_analysis_daily_versions (
  scope_user_id uuid not null,
  business_date date not null,
  version bigint not null default 1,
  primary key (scope_user_id, business_date),
  check (version > 0)
);

create table public.product_analysis_catalog_versions (
  scope_user_id uuid primary key,
  version bigint not null default 1,
  check (version > 0)
);

-- These tables are database-owned materialized contributions. Only daily rows
-- are readable, and RLS keeps each employee inside their own cashier scope.
alter table public.product_analysis_order_products enable row level security;
alter table public.product_analysis_order_pairs enable row level security;
alter table public.product_analysis_daily_sales enable row level security;
alter table public.product_analysis_daily_profit enable row level security;
alter table public.product_analysis_daily_pairs enable row level security;
alter table public.product_analysis_daily_versions enable row level security;
alter table public.product_analysis_catalog_versions enable row level security;

revoke all on public.product_analysis_order_products,
  public.product_analysis_order_pairs,
  public.product_analysis_daily_sales,
  public.product_analysis_daily_profit,
  public.product_analysis_daily_pairs,
  public.product_analysis_daily_versions,
  public.product_analysis_catalog_versions
from public, anon, authenticated;

grant select on public.product_analysis_daily_sales,
  public.product_analysis_daily_profit,
  public.product_analysis_daily_pairs,
  public.product_analysis_daily_versions,
  public.product_analysis_catalog_versions
to authenticated;

create policy product_analysis_sales_read on public.product_analysis_daily_sales
  for select to authenticated using (
    (scope_user_id = '00000000-0000-0000-0000-000000000000'::uuid
      and public.user_has_permission('orders.read_all'))
    or (scope_user_id = (select auth.uid())
      and public.user_has_permission('orders.read_own'))
  );

create policy product_analysis_profit_read on public.product_analysis_daily_profit
  for select to authenticated using (
    public.user_has_permission('products.cost.read') and (
      (scope_user_id = '00000000-0000-0000-0000-000000000000'::uuid
        and public.user_has_permission('orders.read_all'))
      or (scope_user_id = (select auth.uid())
        and public.user_has_permission('orders.read_own'))
    )
  );

create policy product_analysis_pairs_read on public.product_analysis_daily_pairs
  for select to authenticated using (
    (scope_user_id = '00000000-0000-0000-0000-000000000000'::uuid
      and public.user_has_permission('orders.read_all'))
    or (scope_user_id = (select auth.uid())
      and public.user_has_permission('orders.read_own'))
  );

create policy product_analysis_versions_read on public.product_analysis_daily_versions
  for select to authenticated using (
    (scope_user_id = '00000000-0000-0000-0000-000000000000'::uuid
      and public.user_has_permission('orders.read_all'))
    or (scope_user_id = (select auth.uid())
      and public.user_has_permission('orders.read_own'))
  );

create policy product_analysis_catalog_versions_read on public.product_analysis_catalog_versions
  for select to authenticated using (
    (scope_user_id = '00000000-0000-0000-0000-000000000000'::uuid
      and public.user_has_permission('orders.read_all'))
    or (scope_user_id = (select auth.uid())
      and public.user_has_permission('orders.read_own'))
  );

create function public.bump_product_analysis_version(
  p_business_date date,
  p_cashier_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.product_analysis_daily_versions(scope_user_id, business_date, version)
  values ('00000000-0000-0000-0000-000000000000'::uuid, p_business_date, 1)
  on conflict (scope_user_id, business_date)
  do update set version = public.product_analysis_daily_versions.version + 1;

  if p_cashier_id is not null then
    insert into public.product_analysis_daily_versions(scope_user_id, business_date, version)
    values (p_cashier_id, p_business_date, 1)
    on conflict (scope_user_id, business_date)
    do update set version = public.product_analysis_daily_versions.version + 1;
  end if;
end;
$$;
revoke all on function public.bump_product_analysis_version(date, uuid) from public, anon, authenticated;

create function public.bump_product_analysis_catalog_version(p_scope_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.product_analysis_catalog_versions(scope_user_id, version)
  values (p_scope_user_id, 1)
  on conflict (scope_user_id)
  do update set version = public.product_analysis_catalog_versions.version + 1;
$$;
revoke all on function public.bump_product_analysis_catalog_version(uuid) from public, anon, authenticated;

create function public.apply_product_analysis_sales_delta(
  p_scope_user_id uuid,
  p_business_date date,
  p_product_key text,
  p_product_id uuid,
  p_product_name text,
  p_quantity numeric,
  p_net_revenue numeric
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_quantity < 0 then
    update public.product_analysis_daily_sales
    set quantity = quantity + p_quantity,
        net_revenue = net_revenue + p_net_revenue,
        product_id = p_product_id,
        product_name = p_product_name
    where scope_user_id = p_scope_user_id
      and business_date = p_business_date
      and product_key = p_product_key;
    if not found then
      raise exception 'Thiếu đóng góp tổng hợp hàng hóa cần trừ';
    end if;
  else
    insert into public.product_analysis_daily_sales(
      scope_user_id, business_date, product_key, product_id, product_name, quantity, net_revenue
    ) values (
      p_scope_user_id, p_business_date, p_product_key, p_product_id, p_product_name, p_quantity, p_net_revenue
    )
    on conflict (scope_user_id, business_date, product_key)
    do update set
      quantity = public.product_analysis_daily_sales.quantity + excluded.quantity,
      net_revenue = public.product_analysis_daily_sales.net_revenue + excluded.net_revenue,
      product_id = excluded.product_id,
      product_name = excluded.product_name;
  end if;
end;
$$;
revoke all on function public.apply_product_analysis_sales_delta(uuid, date, text, uuid, text, numeric, numeric)
  from public, anon, authenticated;

create function public.apply_product_analysis_profit_delta(
  p_scope_user_id uuid,
  p_business_date date,
  p_product_key text,
  p_gross_profit numeric,
  p_missing_cost_line_count integer,
  p_direction integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_direction < 0 then
    update public.product_analysis_daily_profit
    set gross_profit = gross_profit + p_gross_profit,
        missing_cost_line_count = missing_cost_line_count + p_missing_cost_line_count
    where scope_user_id = p_scope_user_id
      and business_date = p_business_date
      and product_key = p_product_key;
    if not found then
      raise exception 'Thiếu đóng góp tổng hợp giá vốn cần trừ';
    end if;
  else
    insert into public.product_analysis_daily_profit(
      scope_user_id, business_date, product_key, gross_profit, missing_cost_line_count
    ) values (
      p_scope_user_id, p_business_date, p_product_key, p_gross_profit, p_missing_cost_line_count
    )
    on conflict (scope_user_id, business_date, product_key)
    do update set
      gross_profit = public.product_analysis_daily_profit.gross_profit + excluded.gross_profit,
      missing_cost_line_count = public.product_analysis_daily_profit.missing_cost_line_count + excluded.missing_cost_line_count;
  end if;
end;
$$;
revoke all on function public.apply_product_analysis_profit_delta(uuid, date, text, numeric, integer, integer)
  from public, anon, authenticated;

create function public.apply_product_analysis_pair_delta(
  p_scope_user_id uuid,
  p_business_date date,
  p_first_product_key text,
  p_first_product_id uuid,
  p_first_product_name text,
  p_second_product_key text,
  p_second_product_id uuid,
  p_second_product_name text,
  p_count integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_count < 0 then
    update public.product_analysis_daily_pairs
    set co_order_count = co_order_count + p_count,
        first_product_id = p_first_product_id,
        first_product_name = p_first_product_name,
        second_product_id = p_second_product_id,
        second_product_name = p_second_product_name
    where scope_user_id = p_scope_user_id
      and business_date = p_business_date
      and first_product_key = p_first_product_key
      and second_product_key = p_second_product_key;
    if not found then
      raise exception 'Thiếu đóng góp tổng hợp cặp hàng hóa cần trừ';
    end if;
  else
    insert into public.product_analysis_daily_pairs(
      scope_user_id, business_date, first_product_key, first_product_id, first_product_name,
      second_product_key, second_product_id, second_product_name, co_order_count
    ) values (
      p_scope_user_id, p_business_date, p_first_product_key, p_first_product_id, p_first_product_name,
      p_second_product_key, p_second_product_id, p_second_product_name, p_count
    )
    on conflict (scope_user_id, business_date, first_product_key, second_product_key)
    do update set
      first_product_id = excluded.first_product_id,
      first_product_name = excluded.first_product_name,
      second_product_id = excluded.second_product_id,
      second_product_name = excluded.second_product_name,
      co_order_count = public.product_analysis_daily_pairs.co_order_count + excluded.co_order_count;
  end if;
end;
$$;
revoke all on function public.apply_product_analysis_pair_delta(uuid, date, text, uuid, text, text, uuid, text, integer)
  from public, anon, authenticated;

create function public.refresh_product_analysis_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order record;
  v_old record;
  v_new record;
  v_business_date date;
  v_scope_all uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  select o.id, o.cashier_id, o.status, o.created_at, o.discount
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then return; end if;

  select business_date, cashier_id into v_old
  from public.product_analysis_order_products
  where order_id = p_order_id
  limit 1;
  if found then
    perform public.bump_product_analysis_version(v_old.business_date, v_old.cashier_id);

    for v_old in
      select * from public.product_analysis_order_products where order_id = p_order_id
    loop
      perform public.apply_product_analysis_sales_delta(
        v_scope_all, v_old.business_date, v_old.product_key, v_old.product_id,
        v_old.product_name, -v_old.quantity, -v_old.net_revenue
      );
      perform public.apply_product_analysis_profit_delta(
        v_scope_all, v_old.business_date, v_old.product_key,
        -v_old.gross_profit, -v_old.missing_cost_line_count, -1
      );
      if v_old.cashier_id is not null then
        perform public.apply_product_analysis_sales_delta(
          v_old.cashier_id, v_old.business_date, v_old.product_key, v_old.product_id,
          v_old.product_name, -v_old.quantity, -v_old.net_revenue
        );
        perform public.apply_product_analysis_profit_delta(
          v_old.cashier_id, v_old.business_date, v_old.product_key,
          -v_old.gross_profit, -v_old.missing_cost_line_count, -1
        );
      end if;
    end loop;
    delete from public.product_analysis_order_products where order_id = p_order_id;

    for v_old in
      select * from public.product_analysis_order_pairs where order_id = p_order_id
    loop
      perform public.apply_product_analysis_pair_delta(
        v_scope_all, v_old.business_date, v_old.first_product_key, v_old.first_product_id,
        v_old.first_product_name, v_old.second_product_key, v_old.second_product_id,
        v_old.second_product_name, -1
      );
      if v_old.cashier_id is not null then
        perform public.apply_product_analysis_pair_delta(
          v_old.cashier_id, v_old.business_date, v_old.first_product_key, v_old.first_product_id,
          v_old.first_product_name, v_old.second_product_key, v_old.second_product_id,
          v_old.second_product_name, -1
        );
      end if;
    end loop;
    delete from public.product_analysis_order_pairs where order_id = p_order_id;

    delete from public.product_analysis_daily_sales
    where quantity = 0 and net_revenue = 0
      and business_date = v_old.business_date
      and scope_user_id in (v_scope_all, v_old.cashier_id);
    delete from public.product_analysis_daily_profit
    where gross_profit = 0 and missing_cost_line_count = 0
      and business_date = v_old.business_date
      and scope_user_id in (v_scope_all, v_old.cashier_id);
    delete from public.product_analysis_daily_pairs
    where co_order_count = 0
      and business_date = v_old.business_date
      and scope_user_id in (v_scope_all, v_old.cashier_id);
  end if;

  if v_order.status <> 'completed' then return; end if;
  v_business_date := (v_order.created_at at time zone 'Asia/Ho_Chi_Minh')::date;

  with source_lines as (
    select
      oi.id,
      oi.product_id,
      coalesce(nullif(btrim(oi.product_name), ''), 'Hàng hóa') as product_name,
      case when oi.product_id is null
        then 'name:' || lower(btrim(coalesce(nullif(oi.product_name, ''), 'Hàng hóa')))
        else 'product:' || oi.product_id::text
      end as product_key,
      oi.quantity,
      greatest(0, coalesce(oi.line_total, 0)) as line_total,
      oi.display_order,
      cs.unit_cost,
      coalesce(sum(greatest(0, coalesce(oi.line_total, 0))) over (), 0) as order_subtotal
    from public.order_items oi
    left join public.order_item_cost_snapshots cs on cs.order_item_id = oi.id
    where oi.order_id = p_order_id
  ), discount_amount as (
    select coalesce(least(
      max(order_subtotal),
      greatest(0, round(coalesce(v_order.discount, 0)))
    ), 0) as amount, max(order_subtotal) as order_subtotal
    from source_lines
  ), exact_shares as (
    select l.*,
      case when d.order_subtotal > 0 then l.line_total * d.amount / d.order_subtotal else 0 end as exact_share,
      d.amount as discount_amount
    from source_lines l cross join discount_amount d
  ), floored_shares as (
    select *, floor(exact_share) as base_share,
      exact_share - floor(exact_share) as share_remainder
    from exact_shares
  ), ranked_shares as (
    select *,
      discount_amount - sum(base_share) over () as remaining_units,
      row_number() over (order by share_remainder desc, id asc) as remainder_rank
    from floored_shares
  ), allocated_lines as (
    select *, base_share + case when remainder_rank <= remaining_units then 1 else 0 end as allocated_discount
    from ranked_shares
  ), product_totals as (
    select
      product_key,
      product_id,
      max(product_name) as product_name,
      sum(quantity) as quantity,
      sum(greatest(0, line_total - allocated_discount)) as net_revenue,
      sum(case when unit_cost is null then 0
        else greatest(0, line_total - allocated_discount) - round(unit_cost * quantity)
      end) as gross_profit,
      count(*) filter (where unit_cost is null)::integer as missing_cost_line_count,
      count(*)::integer as line_count
    from allocated_lines
    group by product_key, product_id
  )
  insert into public.product_analysis_order_products(
    order_id, business_date, cashier_id, product_key, product_id, product_name,
    quantity, net_revenue, gross_profit, missing_cost_line_count, line_count
  )
  select p_order_id, v_business_date, v_order.cashier_id, product_key, product_id, product_name,
    quantity, net_revenue, gross_profit, missing_cost_line_count, line_count
  from product_totals;

  if exists (select 1 from public.product_analysis_order_products where order_id = p_order_id) then
    perform public.bump_product_analysis_version(v_business_date, v_order.cashier_id);
  end if;

  for v_new in
    select * from public.product_analysis_order_products where order_id = p_order_id
  loop
    perform public.apply_product_analysis_sales_delta(
      v_scope_all, v_business_date, v_new.product_key, v_new.product_id,
      v_new.product_name, v_new.quantity, v_new.net_revenue
    );
    perform public.apply_product_analysis_profit_delta(
      v_scope_all, v_business_date, v_new.product_key,
      v_new.gross_profit, v_new.missing_cost_line_count, 1
    );
    if v_order.cashier_id is not null then
      perform public.apply_product_analysis_sales_delta(
        v_order.cashier_id, v_business_date, v_new.product_key, v_new.product_id,
        v_new.product_name, v_new.quantity, v_new.net_revenue
      );
      perform public.apply_product_analysis_profit_delta(
        v_order.cashier_id, v_business_date, v_new.product_key,
        v_new.gross_profit, v_new.missing_cost_line_count, 1
      );
    end if;
  end loop;

  insert into public.product_analysis_order_pairs(
    order_id, business_date, cashier_id,
    first_product_key, first_product_id, first_product_name,
    second_product_key, second_product_id, second_product_name
  )
  select p_order_id, v_business_date, v_order.cashier_id,
    first_product.product_key, first_product.product_id, first_product.product_name,
    second_product.product_key, second_product.product_id, second_product.product_name
  from public.product_analysis_order_products first_product
  join public.product_analysis_order_products second_product
    on second_product.order_id = first_product.order_id
    and first_product.product_key < second_product.product_key
  where first_product.order_id = p_order_id;

  for v_new in
    select * from public.product_analysis_order_pairs where order_id = p_order_id
  loop
    perform public.apply_product_analysis_pair_delta(
      v_scope_all, v_business_date, v_new.first_product_key, v_new.first_product_id,
      v_new.first_product_name, v_new.second_product_key, v_new.second_product_id,
      v_new.second_product_name, 1
    );
    if v_order.cashier_id is not null then
      perform public.apply_product_analysis_pair_delta(
        v_order.cashier_id, v_business_date, v_new.first_product_key, v_new.first_product_id,
        v_new.first_product_name, v_new.second_product_key, v_new.second_product_id,
        v_new.second_product_name, 1
      );
    end if;
  end loop;
end;
$$;
revoke all on function public.refresh_product_analysis_order(uuid) from public, anon, authenticated;

create function public.refresh_product_analysis_after_order_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_product_analysis_order(new.id);
  return new;
end;
$$;
revoke all on function public.refresh_product_analysis_after_order_change() from public, anon, authenticated;
create trigger product_analysis_orders_after_change
  after insert or update of status, created_at, cashier_id, discount on public.orders
  for each row execute function public.refresh_product_analysis_after_order_change();

create function public.refresh_product_analysis_after_item_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_product_analysis_order(old.order_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    perform public.refresh_product_analysis_order(old.order_id);
  end if;
  perform public.refresh_product_analysis_order(new.order_id);
  return new;
end;
$$;
revoke all on function public.refresh_product_analysis_after_item_change() from public, anon, authenticated;
create trigger product_analysis_order_items_after_change
  after insert or update of order_id, product_id, product_name, quantity, line_total or delete
  on public.order_items
  for each row execute function public.refresh_product_analysis_after_item_change();

create function public.refresh_product_analysis_after_cost_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order_id uuid;
begin
  if tg_op = 'DELETE' then
    select oi.order_id into v_order_id from public.order_items oi where oi.id = old.order_item_id;
  else
    select oi.order_id into v_order_id from public.order_items oi where oi.id = new.order_item_id;
  end if;
  if v_order_id is not null then perform public.refresh_product_analysis_order(v_order_id); end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.refresh_product_analysis_after_cost_change() from public, anon, authenticated;
create trigger product_analysis_cost_snapshots_after_change
  after insert or update of unit_cost or delete on public.order_item_cost_snapshots
  for each row execute function public.refresh_product_analysis_after_cost_change();

create function public.refresh_product_analysis_after_catalog_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_scope record;
begin
  for v_scope in
    select distinct scope_user_id
    from (
      select s.scope_user_id
      from public.product_analysis_daily_sales s
      where s.product_id = new.id
      union
      select p.scope_user_id
      from public.product_analysis_daily_pairs p
      where p.first_product_id = new.id or p.second_product_id = new.id
    ) affected
  loop
    perform public.bump_product_analysis_catalog_version(v_scope.scope_user_id);
  end loop;
  return new;
end;
$$;
revoke all on function public.refresh_product_analysis_after_catalog_change() from public, anon, authenticated;
create trigger product_analysis_catalog_after_change
  after update of name, stock on public.products
  for each row when (old.name is distinct from new.name or old.stock is distinct from new.stock)
  execute function public.refresh_product_analysis_after_catalog_change();

-- Backfill is rerunnable because each call removes its stored contribution before
-- adding the current completed-order contribution. Later writes touch only one order.
select public.refresh_product_analysis_order(o.id)
from public.orders o
where o.status = 'completed'
order by o.id;

create function public.get_product_analysis_metric_days(
  p_metric text,
  p_from date,
  p_to date,
  p_cached_versions jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_scope uuid;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_versions jsonb;
  v_changed_dates date[];
  v_days jsonb;
  v_quantity numeric := 0;
  v_revenue numeric := 0;
  v_product_count bigint := 0;
  v_gross_profit numeric := 0;
  v_missing_cost_line_count bigint := 0;
  v_visible_profit numeric;
  v_numerator numeric;
  v_denominator numeric;
  v_value numeric;
begin
  if auth.uid() is null or not (
    public.user_has_permission('orders.read_all') or public.user_has_permission('orders.read_own')
  ) then
    raise exception 'Không có quyền xem phân tích hàng hóa' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Khoảng ngày phân tích không hợp lệ';
  end if;
  if p_metric not in ('sold_product_count', 'quantity', 'revenue_per_product', 'gross_profit_per_unit') then
    raise exception 'Chỉ số phân tích không hợp lệ';
  end if;
  if p_metric = 'gross_profit_per_unit' and not public.user_has_permission('products.cost.read') then
    raise exception 'Không có quyền xem giá vốn' using errcode = '42501';
  end if;
  v_scope := case when public.user_has_permission('orders.read_all')
    then '00000000-0000-0000-0000-000000000000'::uuid else auth.uid() end;

  select jsonb_object_agg(calendar.business_date::date::text, coalesce(version.version, 0))
  into v_versions
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as calendar(business_date)
  left join public.product_analysis_daily_versions version
    on version.scope_user_id = v_scope and version.business_date = calendar.business_date::date;

  select array_agg(calendar.business_date::date order by calendar.business_date)
  into v_changed_dates
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as calendar(business_date)
  left join public.product_analysis_daily_versions version
    on version.scope_user_id = v_scope and version.business_date = calendar.business_date::date
  where (coalesce(p_cached_versions, '{}'::jsonb) ->> calendar.business_date::date::text)
        is distinct from coalesce(version.version, 0)::text
     or calendar.business_date::date >= v_today;

  select coalesce(sum(s.quantity), 0),
         coalesce(sum(s.net_revenue), 0),
         count(distinct s.product_key)
  into v_quantity, v_revenue, v_product_count
  from public.product_analysis_daily_sales s
  where s.scope_user_id = v_scope and s.business_date between p_from and p_to;

  if p_metric = 'gross_profit_per_unit' then
    select coalesce(sum(profit.gross_profit), 0), coalesce(sum(profit.missing_cost_line_count), 0)
    into v_gross_profit, v_missing_cost_line_count
    from public.product_analysis_daily_profit profit
    where profit.scope_user_id = v_scope and profit.business_date between p_from and p_to;
  end if;

  v_visible_profit := case when v_missing_cost_line_count = 0 then v_gross_profit else null end;
  case p_metric
    when 'sold_product_count' then
      v_numerator := v_product_count; v_denominator := 1; v_value := v_product_count;
    when 'quantity' then
      v_numerator := v_quantity; v_denominator := 1; v_value := v_quantity;
    when 'revenue_per_product' then
      v_numerator := v_revenue; v_denominator := v_product_count;
      v_value := case when v_product_count = 0 then 0 else v_revenue / v_product_count end;
    when 'gross_profit_per_unit' then
      v_numerator := v_visible_profit; v_denominator := v_quantity;
      v_value := case when v_visible_profit is null or v_quantity = 0
        then null else v_visible_profit / v_quantity end;
  end case;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', daily.business_date,
    'version', daily.version,
    'quantity', daily.quantity,
    'revenue', daily.revenue,
    'gross_profit', case when daily.missing_cost_line_count = 0 then daily.gross_profit else null end,
    'missing_cost_line_count', daily.missing_cost_line_count,
    'product_count', daily.product_count,
    'value', case p_metric
      when 'sold_product_count' then daily.product_count
      when 'quantity' then daily.quantity
      when 'revenue_per_product' then case when daily.product_count = 0 then 0 else daily.revenue / daily.product_count end
      when 'gross_profit_per_unit' then case
        when daily.missing_cost_line_count > 0 or daily.quantity = 0 then null
        else daily.gross_profit / daily.quantity
      end
    end
  ) order by daily.business_date), '[]'::jsonb)
  into v_days
  from (
    select changed.business_date::date,
      coalesce(version.version, 0) as version,
      coalesce(sales.quantity, 0) as quantity,
      coalesce(sales.revenue, 0) as revenue,
      coalesce(profit.gross_profit, 0) as gross_profit,
      coalesce(profit.missing_cost_line_count, 0) as missing_cost_line_count,
      coalesce(sales.product_count, 0) as product_count
    from unnest(coalesce(v_changed_dates, array[]::date[])) as changed(business_date)
    left join public.product_analysis_daily_versions version
      on version.scope_user_id = v_scope and version.business_date = changed.business_date
    left join lateral (
      select sum(s.quantity) as quantity, sum(s.net_revenue) as revenue, count(*) as product_count
      from public.product_analysis_daily_sales s
      where s.scope_user_id = v_scope and s.business_date = changed.business_date
    ) sales on true
    left join lateral (
      select sum(p.gross_profit) as gross_profit,
        sum(p.missing_cost_line_count) as missing_cost_line_count
      from public.product_analysis_daily_profit p
      where p.scope_user_id = v_scope and p.business_date = changed.business_date
    ) profit on p_metric = 'gross_profit_per_unit'
  ) daily;

  return jsonb_build_object(
    'versions', coalesce(v_versions, '{}'::jsonb),
    'days', v_days,
    'total', jsonb_build_object(
      'quantity', v_quantity,
      'revenue', v_revenue,
      'gross_profit', v_visible_profit,
      'missing_cost_line_count', v_missing_cost_line_count,
      'product_count', v_product_count,
      'numerator', v_numerator,
      'denominator', v_denominator,
      'value', v_value
    )
  );
end;
$$;
revoke all on function public.get_product_analysis_metric_days(text, date, date, jsonb) from public, anon;
grant execute on function public.get_product_analysis_metric_days(text, date, date, jsonb) to authenticated;

create function public.get_product_analysis_products(
  p_from date,
  p_to date,
  p_query text default '',
  p_metric text default 'quantity',
  p_direction text default 'desc',
  p_page integer default 0,
  p_page_size integer default 10,
  p_show_all boolean default false,
  p_cached_versions jsonb default '{}'::jsonb,
  p_cached_catalog_version bigint default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_scope uuid;
  v_versions jsonb;
  v_catalog_version bigint;
  v_changed boolean;
  v_total_rows bigint;
  v_decile_rows bigint;
  v_selected_rows bigint;
  v_rows jsonb;
  v_page integer := greatest(0, p_page);
  v_page_size integer := least(100, greatest(1, p_page_size));
begin
  if auth.uid() is null or not (
    public.user_has_permission('orders.read_all') or public.user_has_permission('orders.read_own')
  ) then raise exception 'Không có quyền xem phân tích hàng hóa' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  if p_metric not in ('quantity', 'revenue', 'gross_profit') then raise exception 'Chỉ số xếp hạng không hợp lệ'; end if;
  if p_metric = 'gross_profit' and not public.user_has_permission('products.cost.read') then
    raise exception 'Không có quyền xem giá vốn' using errcode = '42501';
  end if;
  if p_direction not in ('asc', 'desc') then raise exception 'Thứ tự sắp xếp không hợp lệ'; end if;
  v_scope := case when public.user_has_permission('orders.read_all')
    then '00000000-0000-0000-0000-000000000000'::uuid else auth.uid() end;

  select jsonb_object_agg(calendar.business_date::date::text, coalesce(version.version, 0))
  into v_versions
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as calendar(business_date)
  left join public.product_analysis_daily_versions version
    on version.scope_user_id = v_scope and version.business_date = calendar.business_date::date;
  select coalesce(catalog.version, 0) into v_catalog_version
  from (select 1) seed
  left join public.product_analysis_catalog_versions catalog on catalog.scope_user_id = v_scope;

  select exists (
    select 1
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as calendar(business_date)
    left join public.product_analysis_daily_versions version
      on version.scope_user_id = v_scope and version.business_date = calendar.business_date::date
    where (coalesce(p_cached_versions, '{}'::jsonb) ->> calendar.business_date::date::text)
          is distinct from coalesce(version.version, 0)::text
       or calendar.business_date::date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date
  ) or p_cached_catalog_version is distinct from v_catalog_version
  into v_changed;

  if not v_changed then
    return jsonb_build_object(
      'needs_refresh', false, 'versions', coalesce(v_versions, '{}'::jsonb),
      'catalog_version', v_catalog_version
    );
  end if;

  with totals as (
    select s.product_key, s.product_id, max(s.product_name) as snapshot_name,
      sum(s.quantity) as quantity, sum(s.net_revenue) as revenue,
      sum(coalesce(profit.gross_profit, 0)) as gross_profit_known,
      sum(coalesce(profit.missing_cost_line_count, 0)) as missing_cost_line_count
    from public.product_analysis_daily_sales s
    left join public.product_analysis_daily_profit profit
      on profit.scope_user_id = s.scope_user_id
      and profit.business_date = s.business_date and profit.product_key = s.product_key
    where s.scope_user_id = v_scope and s.business_date between p_from and p_to
    group by s.product_key, s.product_id
  ), decorated as (
    select totals.product_key as key,
      coalesce(nullif(product.name, ''), totals.snapshot_name) as product_name,
      totals.quantity, totals.revenue,
      case when public.user_has_permission('products.cost.read')
        and totals.missing_cost_line_count = 0 then totals.gross_profit_known else null end as gross_profit,
      totals.missing_cost_line_count,
      product.stock
    from totals left join public.products product on product.id = totals.product_id
  ), matches as (
    select * from decorated
    where public.search_matches(coalesce(p_query, ''), product_name)
  ), counted as (
    select count(*)::bigint as total_rows from matches
  ), ranked as (
    select matches.*,
      row_number() over (order by
        case when p_metric = 'quantity' and p_direction = 'asc' then quantity end asc nulls last,
        case when p_metric = 'quantity' and p_direction = 'desc' then quantity end desc nulls last,
        case when p_metric = 'revenue' and p_direction = 'asc' then revenue end asc nulls last,
        case when p_metric = 'revenue' and p_direction = 'desc' then revenue end desc nulls last,
        case when p_metric = 'gross_profit' and p_direction = 'asc' then gross_profit end asc nulls last,
        case when p_metric = 'gross_profit' and p_direction = 'desc' then gross_profit end desc nulls last,
        product_name asc, key asc
      ) as row_number
    from matches
  ), selected as (
    select ranked.* from ranked
    where p_show_all or nullif(btrim(coalesce(p_query, '')), '') is not null
      or row_number <= greatest(1, ceil((select total_rows * 0.1 from counted))::bigint)
  ), page_rows as (
    select * from selected
    order by row_number
    offset v_page * v_page_size limit v_page_size
  )
  select counted.total_rows,
    greatest(1, ceil(counted.total_rows * 0.1)::bigint),
    coalesce(jsonb_agg(jsonb_build_object(
      'key', page_rows.key, 'product_name', page_rows.product_name,
      'quantity', page_rows.quantity, 'revenue', page_rows.revenue,
      'gross_profit', page_rows.gross_profit, 'stock', page_rows.stock,
      'missing_cost_line_count', page_rows.missing_cost_line_count
    ) order by page_rows.row_number) filter (where page_rows.row_number is not null), '[]'::jsonb)
  into v_total_rows, v_decile_rows, v_rows
  from counted left join page_rows on true
  group by counted.total_rows;

  v_selected_rows := case
    when p_show_all or nullif(btrim(coalesce(p_query, '')), '') is not null then v_total_rows
    else least(v_total_rows, v_decile_rows)
  end;
  return jsonb_build_object(
    'needs_refresh', true,
    'versions', coalesce(v_versions, '{}'::jsonb),
    'catalog_version', v_catalog_version,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'total_rows', v_selected_rows,
    'decile_rows', least(v_total_rows, v_decile_rows)
  );
end;
$$;
revoke all on function public.get_product_analysis_products(date, date, text, text, text, integer, integer, boolean, jsonb, bigint)
  from public, anon;
grant execute on function public.get_product_analysis_products(date, date, text, text, text, integer, integer, boolean, jsonb, bigint)
  to authenticated;

create function public.get_product_analysis_combos(
  p_from date,
  p_to date,
  p_cached_versions jsonb default '{}'::jsonb,
  p_cached_catalog_version bigint default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_scope uuid;
  v_versions jsonb;
  v_catalog_version bigint;
  v_changed boolean;
  v_rows jsonb;
begin
  if auth.uid() is null or not (
    public.user_has_permission('orders.read_all') or public.user_has_permission('orders.read_own')
  ) then raise exception 'Không có quyền xem phân tích hàng hóa' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Khoảng ngày không hợp lệ'; end if;
  v_scope := case when public.user_has_permission('orders.read_all')
    then '00000000-0000-0000-0000-000000000000'::uuid else auth.uid() end;

  select jsonb_object_agg(calendar.business_date::date::text, coalesce(version.version, 0))
  into v_versions
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as calendar(business_date)
  left join public.product_analysis_daily_versions version
    on version.scope_user_id = v_scope and version.business_date = calendar.business_date::date;
  select coalesce(catalog.version, 0) into v_catalog_version
  from (select 1) seed
  left join public.product_analysis_catalog_versions catalog on catalog.scope_user_id = v_scope;
  select exists (
    select 1
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as calendar(business_date)
    left join public.product_analysis_daily_versions version
      on version.scope_user_id = v_scope and version.business_date = calendar.business_date::date
    where (coalesce(p_cached_versions, '{}'::jsonb) ->> calendar.business_date::date::text)
          is distinct from coalesce(version.version, 0)::text
       or calendar.business_date::date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date
  ) or p_cached_catalog_version is distinct from v_catalog_version
  into v_changed;
  if not v_changed then
    return jsonb_build_object(
      'needs_refresh', false, 'versions', coalesce(v_versions, '{}'::jsonb),
      'catalog_version', v_catalog_version
    );
  end if;

  with ranked_pairs as (
    select pair.first_product_key, pair.first_product_id,
      max(pair.first_product_name) as first_snapshot_name,
      pair.second_product_key, pair.second_product_id,
      max(pair.second_product_name) as second_snapshot_name,
      sum(pair.co_order_count)::bigint as co_order_count
    from public.product_analysis_daily_pairs pair
    where pair.scope_user_id = v_scope and pair.business_date between p_from and p_to
    group by pair.first_product_key, pair.first_product_id,
      pair.second_product_key, pair.second_product_id
  ), decorated as (
    select ranked_pairs.*,
      coalesce(nullif(first_product.name, ''), ranked_pairs.first_snapshot_name) as first_product,
      coalesce(nullif(second_product.name, ''), ranked_pairs.second_snapshot_name) as second_product
    from ranked_pairs
    left join public.products first_product on first_product.id = ranked_pairs.first_product_id
    left join public.products second_product on second_product.id = ranked_pairs.second_product_id
  ), top_pairs as (
    select * from decorated
    order by co_order_count desc, first_product_key, second_product_key
    limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', first_product_key || '|' || second_product_key,
    'first_product', first_product, 'second_product', second_product,
    'co_order_count', co_order_count
  ) order by co_order_count desc, first_product_key, second_product_key), '[]'::jsonb)
  into v_rows
  from top_pairs;

  return jsonb_build_object(
    'needs_refresh', true,
    'versions', coalesce(v_versions, '{}'::jsonb),
    'catalog_version', v_catalog_version,
    'rows', v_rows
  );
end;
$$;
revoke all on function public.get_product_analysis_combos(date, date, jsonb, bigint) from public, anon;
grant execute on function public.get_product_analysis_combos(date, date, jsonb, bigint) to authenticated;
