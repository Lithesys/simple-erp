-- Reuse the daily product aggregates for gross profit while keeping the
-- existing gross line-revenue semantics for the product detail summary.
create or replace function public.get_product_sales_summary(
  p_product_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid;
  v_can_view_profit boolean;
  v_quantity numeric(14, 3);
  v_revenue numeric(14, 0);
  v_gross_profit numeric;
  v_missing_cost_line_count integer;
  v_days jsonb;
begin
  if auth.uid() is null or not public.user_has_permission('products.read') then
    raise exception 'Không có quyền xem thống kê hàng hóa' using errcode = '42501';
  end if;
  if not (
    public.user_has_permission('orders.read_all') or
    public.user_has_permission('orders.read_own')
  ) then
    raise exception 'Không có quyền xem thống kê đơn hàng' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Khoảng thời gian thống kê không hợp lệ';
  end if;

  v_scope := case when public.user_has_permission('orders.read_all')
    then '00000000-0000-0000-0000-000000000000'::uuid
    else auth.uid()
  end;
  v_can_view_profit := public.user_has_permission('products.cost.read');

  with sales_by_day as (
    select
      (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date as business_date,
      sum(oi.quantity) as quantity,
      sum(oi.line_total) as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = p_product_id
      and o.status = 'completed'
      and (v_scope = '00000000-0000-0000-0000-000000000000'::uuid or o.cashier_id = auth.uid())
      and o.created_at >= (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    group by (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date
  ), profit_by_day as (
    select
      sales.business_date,
      sum(coalesce(profit.gross_profit, 0)) as gross_profit,
      sum(case
        when product_day.product_id is null or profit.product_key is null then 1
        else profit.missing_cost_line_count
      end)::integer as missing_cost_line_count
    from sales_by_day sales
    left join public.product_analysis_daily_sales product_day
      on product_day.business_date = sales.business_date
      and product_day.scope_user_id = v_scope
      and product_day.product_id = p_product_id
    left join public.product_analysis_daily_profit profit
      on profit.scope_user_id = product_day.scope_user_id
      and profit.business_date = product_day.business_date
      and profit.product_key = product_day.product_key
    where v_can_view_profit
    group by sales.business_date
  ), daily as (
    select sales.business_date, sales.quantity, sales.revenue,
      coalesce(profit.gross_profit, 0) as gross_profit,
      coalesce(profit.missing_cost_line_count, 0) as missing_cost_line_count
    from sales_by_day sales
    left join profit_by_day profit using (business_date)
  )
  select
    coalesce(sum(daily.quantity), 0)::numeric(14, 3),
    coalesce(sum(daily.revenue), 0)::numeric(14, 0),
    coalesce(sum(daily.gross_profit), 0),
    coalesce(sum(daily.missing_cost_line_count), 0)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'date', daily.business_date,
      'quantity', daily.quantity,
      'revenue', daily.revenue,
      'gross_profit', case
        when v_can_view_profit and daily.missing_cost_line_count = 0 then daily.gross_profit
        else null
      end,
      'missing_cost_line_count', daily.missing_cost_line_count
    ) order by daily.business_date), '[]'::jsonb)
  into v_quantity, v_revenue, v_gross_profit, v_missing_cost_line_count, v_days
  from daily;

  return jsonb_build_object(
    'quantity', v_quantity,
    'revenue', v_revenue,
    'gross_profit', case
      when v_can_view_profit and v_missing_cost_line_count = 0 then v_gross_profit
      else null
    end,
    'missing_cost_line_count', v_missing_cost_line_count,
    'days', v_days
  );
end;
$$;

revoke all on function public.get_product_sales_summary(uuid, date, date) from public, anon;
grant execute on function public.get_product_sales_summary(uuid, date, date) to authenticated;
