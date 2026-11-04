-- Stock-check data is read and written through permission-checked RPC functions only.
revoke all on public.stock_checks, public.stock_check_items,
  public.stock_check_events, public.stock_check_requests
  from public, anon, authenticated;

create policy stock_checks_rpc_only
  on public.stock_checks for all to authenticated
  using (false) with check (false);

create policy stock_check_items_rpc_only
  on public.stock_check_items for all to authenticated
  using (false) with check (false);

create policy stock_check_events_rpc_only
  on public.stock_check_events for all to authenticated
  using (false) with check (false);

create policy stock_check_requests_rpc_only
  on public.stock_check_requests for all to authenticated
  using (false) with check (false);
