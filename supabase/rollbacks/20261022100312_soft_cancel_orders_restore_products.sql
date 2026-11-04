-- Rollback for 20261022100312_soft_cancel_orders_restore_products.sql.
-- This restores the previous hard-delete behavior. Export relevant data first if cancellation
-- effects must be recoverable; inventory restorations already recorded by this migration remain.

drop function if exists public.cancel_order(uuid);
drop function if exists public.reactivate_product(uuid);

drop trigger if exists orders_prevent_hard_delete on public.orders;
drop function if exists public.prevent_order_hard_delete();
drop trigger if exists orders_prevent_cancelled_reactivation on public.orders;
drop function if exists public.prevent_cancelled_order_reactivation();

grant delete on table public.orders to anon, authenticated;

create or replace function public.delete_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_item record;
begin
  if auth.uid() is null or not public.user_has_permission('orders.delete') then
    raise exception 'Không có quyền xóa đơn hàng' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = p_order_id and status = 'completed' for update;
  if not found then raise exception 'Không tìm thấy đơn hàng hoặc đơn đã được xử lý'; end if;

  perform p.id from public.products p where p.id in (
    select oi.product_id from public.order_items oi where oi.order_id = p_order_id and oi.product_id is not null
    union
    select component.product_id from public.order_item_components component
    join public.order_items oi on oi.id = component.order_item_id
    where oi.order_id = p_order_id and component.product_id is not null
  ) order by p.id for update;

  perform set_config('app.checkout_order_id', p_order_id::text, true);
  perform set_config('app.inventory_reason', 'Hoàn kho do xóa đơn hàng', true);
  for v_item in
    with restoration as (
      select oi.product_id, sum(oi.quantity) as quantity
      from public.order_items oi
      join public.products product on product.id = oi.product_id and product.kind = 'product'
      where oi.order_id = p_order_id
      group by oi.product_id
      union all
      select component.product_id, sum(oi.quantity * component.quantity_per_bundle) as quantity
      from public.order_item_components component
      join public.order_items oi on oi.id = component.order_item_id
      where oi.order_id = p_order_id and component.product_id is not null
      group by component.product_id
    )
    select product_id, round(sum(quantity), 3) as quantity
    from restoration group by product_id order by product_id
  loop
    update public.products set stock = stock + v_item.quantity where id = v_item.product_id;
  end loop;
  delete from public.orders where id = p_order_id;
end;
$$;
revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated;

drop function public.get_products_page(text, text, integer, integer, text, text, text);
create function public.get_products_page(
  p_query text default '',
  p_stock_filter text default 'all',
  p_page integer default 1,
  p_page_size integer default 20,
  p_sort text default 'name',
  p_direction text default 'asc'
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as materialized (
    select p.id, p.sku, p.name, p.unit, p.stock
    from public.products p
    where p.is_active
      and public.search_matches(p_query, coalesce(p.name, '') || ' ' || coalesce(p.sku, ''))
      and (
        p_stock_filter not in ('in-stock', 'out-of-stock')
        or (p_stock_filter = 'in-stock' and p.stock > 0)
        or (p_stock_filter = 'out-of-stock' and p.stock <= 0)
      )
  ), ranked as (
    select matches.id,
      row_number() over (order by
        case when p_sort = 'sku' and lower(p_direction) <> 'desc' then sku end asc,
        case when p_sort = 'sku' and lower(p_direction) = 'desc' then sku end desc,
        case when p_sort = 'name' and lower(p_direction) <> 'desc' then name end asc,
        case when p_sort = 'name' and lower(p_direction) = 'desc' then name end desc,
        case when p_sort = 'unit' and lower(p_direction) <> 'desc' then unit end asc,
        case when p_sort = 'unit' and lower(p_direction) = 'desc' then unit end desc,
        case when p_sort = 'stock' and lower(p_direction) <> 'desc' then stock end asc,
        case when p_sort = 'stock' and lower(p_direction) = 'desc' then stock end desc,
        id asc) as sort_row
    from matches
  ), page as (
    select id, sort_row from ranked order by sort_row
    offset (greatest(1, p_page) - 1) * least(100, greatest(1, p_page_size))
    limit least(100, greatest(1, p_page_size))
  )
  select jsonb_build_object(
    'ids', coalesce((select jsonb_agg(page.id order by page.sort_row) from page), '[]'::jsonb),
    'total', (select count(*) from matches)
  );
$$;
revoke all on function public.get_products_page(text, text, integer, integer, text, text) from public, anon;
grant execute on function public.get_products_page(text, text, integer, integer, text, text) to authenticated;

drop function public.get_products_page_summary(text, text, text);
create function public.get_products_page_summary(
  p_query text default '',
  p_stock_filter text default 'all'
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as (
    select p.stock, pc.cost
    from public.products p
    left join public.product_costs pc on pc.product_id = p.id
    where p.is_active
      and public.search_matches(p_query, coalesce(p.name, '') || ' ' || coalesce(p.sku, ''))
      and (
        p_stock_filter not in ('in-stock', 'out-of-stock')
        or (p_stock_filter = 'in-stock' and p.stock > 0)
        or (p_stock_filter = 'out-of-stock' and p.stock <= 0)
      )
  )
  select jsonb_build_object(
    'count', count(*),
    'stock_total', coalesce(sum(stock), 0),
    'inventory_capital', case
      when public.user_has_permission('products.cost.read') then coalesce(sum(stock * cost), 0)
      else null
    end
  ) from matches;
$$;
revoke all on function public.get_products_page_summary(text, text) from public, anon;
grant execute on function public.get_products_page_summary(text, text) to authenticated;

drop policy if exists "read active products" on public.products;
create policy "read active products" on public.products for select to authenticated
using (
  (is_active and (public.user_has_permission('products.read') or public.user_has_permission('sales.create')))
  or public.user_has_permission('products.update')
);

create or replace function public.orders_summary_filtered(
  p_invoice_query text default '',
  p_customer_query text default '',
  p_product_skus text[] default '{}',
  p_statuses text[] default array['completed']::text[],
  p_from date default null,
  p_to date default null
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'count', count(*),
    'subtotal', coalesce(sum(o.subtotal), 0),
    'discount', coalesce(sum(o.discount), 0),
    'total', coalesce(sum(o.total), 0),
    'profit', case
      when public.user_has_permission('products.cost.read') then coalesce(sum(profit_snapshot.profit), 0)
      else null
    end
  )
  from public.orders o
  left join public.order_profit_snapshots profit_snapshot on profit_snapshot.order_id = o.id
  where (coalesce(cardinality(p_statuses), 0) = 0 or o.status = any(p_statuses))
    and public.search_matches(p_invoice_query, o.order_no)
    and public.search_matches(p_customer_query, coalesce(o.customer_name, '') || ' ' || coalesce(o.customer_phone, ''))
    and (coalesce(cardinality(p_product_skus), 0) = 0 or exists (
      select 1 from public.order_items oi where oi.order_id = o.id and oi.sku = any(p_product_skus)
    ))
    and (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
    and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'));
$$;
revoke all on function public.orders_summary_filtered(text, text, text[], text[], date, date) from public, anon;
grant execute on function public.orders_summary_filtered(text, text, text[], text[], date, date) to authenticated;
