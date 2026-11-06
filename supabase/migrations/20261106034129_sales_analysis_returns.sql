-- Add canceled-order return totals to the sales analysis chart.
create or replace function public.get_sales_analysis_chart(
  p_from date,
  p_to date,
  p_metric text,
  p_price_list_id uuid default null
)
returns table(label text, business_date date, amount numeric)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Cần đăng nhập để xem báo cáo bán hàng' using errcode = '28000';
  end if;
  if not public.user_has_permission('orders.read_all')
    and not public.user_has_permission('orders.read_own') then
    raise exception 'Không có quyền xem báo cáo bán hàng' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'Khoảng thời gian phải từ 1 đến 366 ngày' using errcode = '22023';
  end if;
  if p_metric is null or p_metric not in ('time', 'profit', 'discount', 'returns', 'employee') then
    raise exception 'Chỉ số báo cáo không hợp lệ' using errcode = '22023';
  end if;
  if p_metric = 'profit' and not public.user_has_permission('products.cost.read') then
    raise exception 'Không có quyền xem giá vốn để tính lợi nhuận' using errcode = '42501';
  end if;

  if p_metric = 'employee' then
    return query
      select
        coalesce(nullif(btrim(profile.display_name), ''), nullif(profile.username, ''), 'Tài khoản') as label,
        null::date as business_date,
        sum(sale.total)::numeric as amount
      from public.orders sale
      left join public.profiles profile on profile.id = sale.cashier_id
      where sale.status = 'completed'
        and sale.created_at >= (p_from::timestamp at time zone 'Asia/Bangkok')
        and sale.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok')
        and (p_price_list_id is null or sale.price_list_id = p_price_list_id)
        and (
          public.user_has_permission('orders.read_all')
          or (
            public.user_has_permission('orders.read_own')
            and sale.cashier_id = auth.uid()
          )
        )
      group by coalesce(nullif(btrim(profile.display_name), ''), nullif(profile.username, ''), 'Tài khoản')
      order by sum(sale.total) desc, label;
    return;
  end if;

  return query
    with date_range as (
      select generate_series(
        p_from::timestamp,
        p_to::timestamp,
        interval '1 day'
      )::date as day
    ), scoped_orders as (
      select
        sale.id,
        sale.total,
        sale.discount,
        (sale.created_at at time zone 'Asia/Bangkok')::date as day
      from public.orders sale
      where (
          (p_metric = 'returns' and sale.status = 'cancelled')
          or (p_metric <> 'returns' and sale.status = 'completed')
        )
        and sale.created_at >= (p_from::timestamp at time zone 'Asia/Bangkok')
        and sale.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok')
        and (p_price_list_id is null or sale.price_list_id = p_price_list_id)
        and (
          public.user_has_permission('orders.read_all')
          or (
            public.user_has_permission('orders.read_own')
            and sale.cashier_id = auth.uid()
          )
        )
    ), daily_totals as (
      select
        scoped.day,
        sum(case p_metric
          when 'discount' then scoped.discount
          when 'returns' then scoped.total
          when 'profit' then coalesce(profit_snapshot.profit, 0)
          else scoped.total
        end)::numeric as amount
      from scoped_orders scoped
      left join public.order_profit_snapshots profit_snapshot
        on profit_snapshot.order_id = scoped.id
      group by scoped.day
    )
    select
      to_char(date_range.day, case when p_to - p_from <= 31 then 'DD' else 'DD/MM' end),
      date_range.day,
      coalesce(daily_totals.amount, 0)::numeric
    from date_range
    left join daily_totals on daily_totals.day = date_range.day
    order by date_range.day;
end;
$$;
revoke all on function public.get_sales_analysis_chart(date, date, text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_sales_analysis_chart(date, date, text, uuid)
  to authenticated;