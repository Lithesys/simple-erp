-- This rollback removes stock-check records and their audit trail. Export those
-- records first if they must be retained. Product stock is not changed here.
create or replace function public.record_stock_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_purchase_order_id uuid;
  v_reason text;
begin
  if new.stock is distinct from old.stock then
    v_order_id := nullif(current_setting('app.checkout_order_id', true), '')::uuid;
    v_purchase_order_id := nullif(current_setting('app.purchase_order_id', true), '')::uuid;
    v_reason := coalesce(
      nullif(current_setting('app.inventory_reason', true), ''),
      case when v_order_id is null then 'Điều chỉnh tồn kho' else 'Bán hàng' end
    );
    insert into public.inventory_movements(
      product_id, order_id, purchase_order_id, quantity_change, stock_after, reason, actor_id
    ) values (
      new.id, v_order_id, v_purchase_order_id, new.stock - old.stock, new.stock, v_reason, auth.uid()
    );
  end if;
  return new;
end $$;

update public.inventory_movements
set reason = 'Điều chỉnh tồn kho'
where stock_check_id is not null and reason in ('Kiểm kho', 'Hủy kiểm kho');

drop function if exists public.get_product_inventory_history(uuid);
alter table public.inventory_movements drop column stock_check_id;
drop table if exists public.stock_check_requests;
drop table if exists public.stock_check_events;
drop table if exists public.stock_check_items;
drop table if exists public.stock_checks;
drop sequence if exists public.stock_check_number_seq;

update public.roles
set permissions = array_remove(array_remove(array_remove(array_remove(array_remove(array_remove(
  permissions, 'stock_checks.read'), 'stock_checks.create'), 'stock_checks.update'),
  'stock_checks.delete'), 'stock_checks.complete'), 'stock_checks.export');

create function public.get_product_inventory_history(p_product_id uuid)
returns table(
  id uuid, created_at timestamptz, reason text, quantity_change numeric, stock_after numeric,
  counterparty text, actor_name text, order_id uuid, purchase_order_id uuid,
  order_no text, purchase_no text, source_date date, is_cancelled boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (
    public.user_has_permission('products.read') or public.user_has_permission('products.update')
  ) then raise exception 'Không có quyền xem lịch sử hàng hóa' using errcode = '42501'; end if;
  return query
  select m.id, m.created_at, m.reason, m.quantity_change,
    coalesce(m.stock_after, p.stock - coalesce((
      select sum(later.quantity_change) from public.inventory_movements later
      where later.product_id = m.product_id
        and (later.created_at > m.created_at or (later.created_at = m.created_at and later.id > m.id))
    ), 0)) as stock_after,
    coalesce(o.customer_name, po.purchase_no, '—') as counterparty,
    coalesce(nullif(actor.display_name, ''), '—') as actor_name,
    m.order_id, m.purchase_order_id, o.order_no, po.purchase_no,
    case when o.id is not null then (o.created_at at time zone 'Asia/Bangkok')::date
      when po.id is not null then (po.created_at at time zone 'Asia/Bangkok')::date else null end as source_date,
    (coalesce(o.status = 'cancelled', false) or coalesce(po.status = 'cancelled', false)) as is_cancelled
  from public.inventory_movements m
  left join public.products p on p.id = m.product_id
  left join public.orders o on o.id = m.order_id
  left join public.purchase_orders po on po.id = m.purchase_order_id
  left join public.profiles actor on actor.id = m.actor_id
  where m.product_id = p_product_id
  order by m.created_at desc, m.id desc limit 200;
end $$;
revoke all on function public.get_product_inventory_history(uuid) from public, anon;
grant execute on function public.get_product_inventory_history(uuid) to authenticated;
notify pgrst, 'reload schema';
