-- Keep historical unit costs and order profit separate from the mutable product catalog.
create table public.order_item_cost_snapshots (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  unit_cost numeric(14,2) not null check (unit_cost >= 0)
);

create table public.order_profit_snapshots (
  order_id uuid primary key references public.orders(id) on delete cascade,
  profit numeric(14,0) not null default 0
);

alter table public.order_item_cost_snapshots enable row level security;
alter table public.order_profit_snapshots enable row level security;
revoke all on public.order_item_cost_snapshots, public.order_profit_snapshots from anon, authenticated;
grant select on public.order_item_cost_snapshots, public.order_profit_snapshots to authenticated;

create policy order_item_cost_snapshots_read on public.order_item_cost_snapshots
  for select to authenticated using (
    public.user_has_permission('products.cost.read') and exists (
      select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id and (
        public.user_has_permission('orders.read_all') or
        (public.user_has_permission('orders.read_own') and o.cashier_id = (select auth.uid()))
      )
    )
  );
create policy order_profit_snapshots_read on public.order_profit_snapshots
  for select to authenticated using (
    public.user_has_permission('products.cost.read') and exists (
      select 1 from public.orders o where o.id = order_id and (
        public.user_has_permission('orders.read_all') or
        (public.user_has_permission('orders.read_own') and o.cashier_id = (select auth.uid()))
      )
    )
  );

-- Existing sales receive a one-time best-effort cost snapshot from the current catalog.
insert into public.order_item_cost_snapshots(order_item_id, unit_cost)
select oi.id, coalesce(pc.cost, 0)
from public.order_items oi
left join public.product_costs pc on pc.product_id = oi.product_id
on conflict (order_item_id) do nothing;

create or replace function public.refresh_order_profit_snapshot(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_total numeric(14,0); v_cost numeric(14,0);
begin
  select o.total, coalesce(sum(round(oi.quantity * coalesce(cs.unit_cost, 0))), 0)
    into v_total, v_cost
  from public.orders o
  left join public.order_items oi on oi.order_id = o.id
  left join public.order_item_cost_snapshots cs on cs.order_item_id = oi.id
  where o.id = p_order_id
  group by o.total;
  if not found then return; end if;
  insert into public.order_profit_snapshots(order_id, profit)
  values (p_order_id, v_total - v_cost)
  on conflict (order_id) do update set profit = excluded.profit;
end;
$$;
revoke all on function public.refresh_order_profit_snapshot(uuid) from public, anon, authenticated;

create or replace function public.snapshot_order_item_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_unit_cost numeric(14,2);
begin
  if tg_op = 'INSERT' then
    select coalesce(pc.cost, 0) into v_unit_cost
    from public.order_items oi left join public.product_costs pc on pc.product_id = oi.product_id
    where oi.id = new.id;
    insert into public.order_item_cost_snapshots(order_item_id, unit_cost)
    values (new.id, coalesce(v_unit_cost, 0)) on conflict (order_item_id) do nothing;
    perform public.refresh_order_profit_snapshot(new.order_id);
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.refresh_order_profit_snapshot(new.order_id);
    return new;
  else
    perform public.refresh_order_profit_snapshot(old.order_id);
    return old;
  end if;
end;
$$;
revoke all on function public.snapshot_order_item_cost() from public, anon, authenticated;
create trigger snapshot_order_item_cost_after_write
  after insert or update of quantity, unit_price, line_total or delete on public.order_items
  for each row execute function public.snapshot_order_item_cost();

create or replace function public.refresh_order_profit_after_total_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_order_profit_snapshot(new.id);
  return new;
end;
$$;
revoke all on function public.refresh_order_profit_after_total_change() from public, anon, authenticated;
create trigger refresh_order_profit_after_total_change
  after insert or update of total on public.orders
  for each row execute function public.refresh_order_profit_after_total_change();

select public.refresh_order_profit_snapshot(o.id) from public.orders o;

-- Include item names and SKUs in the list RPC so the management page can search them.
drop function public.get_purchase_orders();
create function public.get_purchase_orders()
returns table(id uuid, purchase_no text, purchased_at timestamptz, received_at timestamptz, status text, total numeric, product_search text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    public.user_has_permission('purchases.read') or
    public.user_has_permission('purchases.update') or
    public.user_has_permission('purchases.delete') or
    public.user_has_permission('purchases.approve')
  ) then
    raise exception 'Không có quyền xem danh sách đơn nhập' using errcode = '42501';
  end if;
  return query
    select po.id, po.purchase_no, po.purchased_at, po.received_at, po.status,
      case when public.user_has_permission('products.cost.read') then po.total else null end,
      coalesce(items.product_search, '')
    from public.purchase_orders po
    left join lateral (
      select string_agg(poi.sku || ' ' || poi.product_name, ' ') as product_search
      from public.purchase_order_items poi where poi.purchase_order_id = po.id
    ) items on true
    order by po.purchased_at desc
    limit 200;
end;
$$;
revoke all on function public.get_purchase_orders() from public, anon;
grant execute on function public.get_purchase_orders() to authenticated;
