create or replace function public.get_product_inventory_history_page(
  p_product_id uuid,
  p_page integer default 1,
  p_page_size integer default 20,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_result jsonb;
begin
  if auth.uid() is null or not (
    public.user_has_permission('products.read') or
    public.user_has_permission('products.update')
  ) then
    raise exception 'Không có quyền xem lịch sử hàng hóa' using errcode = '42501';
  end if;

  with matched as materialized (
    select
      m.id,
      m.created_at,
      m.reason,
      m.quantity_change,
      coalesce(m.stock_after, p.stock - coalesce((
        select sum(later.quantity_change)
        from public.inventory_movements later
        where later.product_id = m.product_id
          and (later.created_at > m.created_at or (later.created_at = m.created_at and later.id > m.id))
      ), 0)) as stock_after,
      coalesce(o.customer_name, po.purchase_no, sc.stock_check_no, '—') as counterparty,
      coalesce(nullif(actor.display_name, ''), '—') as actor_name,
      m.order_id,
      m.purchase_order_id,
      o.order_no,
      po.purchase_no,
      case
        when o.id is not null then (o.created_at at time zone 'Asia/Bangkok')::date
        when po.id is not null then (po.created_at at time zone 'Asia/Bangkok')::date
        else null
      end as source_date,
      (coalesce(o.status = 'cancelled', false) or coalesce(po.status = 'cancelled', false)) as is_cancelled,
      m.stock_check_id
    from public.inventory_movements m
    left join public.products p on p.id = m.product_id
    left join public.orders o on o.id = m.order_id
    left join public.purchase_orders po on po.id = m.purchase_order_id
    left join public.stock_checks sc on sc.id = m.stock_check_id
    left join public.profiles actor on actor.id = m.actor_id
    where m.product_id = p_product_id
      and (p_from is null or (m.created_at at time zone 'Asia/Bangkok')::date >= p_from)
      and (p_to is null or (m.created_at at time zone 'Asia/Bangkok')::date <= p_to)
  ),
  metadata as (
    select count(*) as total, coalesce(sum(quantity_change), 0) as quantity_change_total
    from matched
  ),
  page_rows as (
    select *
    from matched
    order by created_at desc, id desc
    offset ((v_page - 1)::bigint * v_page_size)
    limit v_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page_rows) order by created_at desc, id desc)
      from page_rows
    ), '[]'::jsonb),
    'total', metadata.total,
    'quantity_change_total', metadata.quantity_change_total
  )
  into v_result
  from metadata;

  return v_result;
end;
$$;

revoke all on function public.get_product_inventory_history_page(uuid, integer, integer, date, date) from public, anon;
grant execute on function public.get_product_inventory_history_page(uuid, integer, integer, date, date) to authenticated;

notify pgrst, 'reload schema';
