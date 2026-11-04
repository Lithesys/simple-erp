drop policy if exists stock_checks_rpc_only on public.stock_checks;
drop policy if exists stock_check_items_rpc_only on public.stock_check_items;
drop policy if exists stock_check_events_rpc_only on public.stock_check_events;
drop policy if exists stock_check_requests_rpc_only on public.stock_check_requests;

grant select, insert, update, delete on public.stock_checks, public.stock_check_items,
  public.stock_check_events, public.stock_check_requests to authenticated;
