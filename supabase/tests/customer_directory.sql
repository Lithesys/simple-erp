-- Run against a migrated database with an active Admin profile. All fixture writes roll back.
begin;
do $$ begin
  if not exists(select 1 from public.profiles p join public.roles r on r.id=p.role_id where p.is_active and r.name='Admin') then
    raise exception 'An active Admin profile is required';
  end if;
  if has_table_privilege('anon', 'public.customers', 'SELECT') or has_function_privilege('anon', 'public.search_customers(text,integer,integer)', 'EXECUTE') then
    raise exception 'Anonymous access must be denied';
  end if;
end $$;
select set_config('request.jwt.claim.sub', (select p.id::text from public.profiles p join public.roles r on r.id=p.role_id where p.is_active and r.name='Admin' limit 1), true);
set local role authenticated;
do $$
declare v_customer uuid; v_count integer;
begin
  insert into public.customers(name,phone,address) values ('__customer_test__','0900123456','Địa chỉ kiểm thử') returning id into v_customer;
  update public.customers set address='Địa chỉ mới' where id=v_customer;
  if not exists(select 1 from public.customers where id=v_customer and address='Địa chỉ mới' and phone='0900123456') then raise exception 'CRUD update/read failed'; end if;
  if (public.search_customers('__customer_test__',0,8)->>'total')::integer <> 1 then raise exception 'Search failed'; end if;
  delete from public.customers where id=v_customer;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Delete failed'; end if;
end $$;
reset role;
-- A caller without an active application profile cannot read or mutate the directory.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
declare v_count integer;
begin
  if exists(select 1 from public.customers) then raise exception 'Unauthorized read'; end if;
  if (public.search_customers('',0,8)->>'total')::integer <> 0 then raise exception 'Unauthorized search'; end if;
  begin
    insert into public.customers(name) values ('__denied__');
    raise exception 'Unauthorized insert';
  exception when insufficient_privilege then null; end;
  update public.customers set name='__denied__'; get diagnostics v_count=row_count;
  if v_count <> 0 then raise exception 'Unauthorized update'; end if;
  delete from public.customers; get diagnostics v_count=row_count;
  if v_count <> 0 then raise exception 'Unauthorized delete'; end if;
end $$;
reset role;
-- Cashiers can search, but cannot create/edit/delete customer records.
select set_config('request.jwt.claim.sub', '', true);
do $$ declare v_user uuid := gen_random_uuid(); begin
  insert into auth.users(id) values(v_user);
  insert into public.profiles(id,display_name,role_id) values(v_user,'Customer test cashier',(select id from public.roles where name='Nhân viên'));
  perform set_config('request.jwt.claim.sub',v_user::text,true);
end $$;
set local role authenticated;
do $$ declare v_count integer; begin
  if not public.user_has_permission('sales.create') then raise exception 'Cashier fixture failed'; end if;
  if (public.search_customers('',0,8)->>'total')::integer < 1 then raise exception 'Cashier search denied'; end if;
  begin
    insert into public.customers(name) values ('__denied_cashier__');
    raise exception 'Cashier insert allowed';
  exception when insufficient_privilege then null; end;
  update public.customers set name='__denied_cashier__'; get diagnostics v_count=row_count;
  if v_count <> 0 then raise exception 'Cashier update allowed'; end if;
  delete from public.customers; get diagnostics v_count=row_count;
  if v_count <> 0 then raise exception 'Cashier delete allowed'; end if;
end $$;
reset role;
-- Use a disposable product; verify checkout snapshots and retry without committing a sale.
do $$
declare v_product uuid; v_list uuid;
begin
  insert into public.products(sku,name,stock) values('__customer_test_' || gen_random_uuid()::text,'Customer test product',10) returning id into v_product;
  select id into v_list from public.price_lists where is_active limit 1;
  insert into public.product_prices(product_id,price_list_id,price) values(v_product,v_list,1000);
  perform set_config('test.product',v_product::text,true);
  perform set_config('test.price_list',v_list::text,true);
end $$;
set local role authenticated;
do $$
declare v_result jsonb; v_retry jsonb; v_key uuid := gen_random_uuid(); v_lines jsonb; v_order public.orders;
begin
  v_lines := jsonb_build_array(jsonb_build_object('product_id',current_setting('test.product'),'quantity',1,'expected_price',1000));
  v_result := public.checkout_order(v_key,current_setting('test.price_list')::uuid,'Customer snapshot',0,v_lines,'0900123456','Địa chỉ hóa đơn');
  v_retry := public.checkout_order(v_key,current_setting('test.price_list')::uuid,'Changed',0,v_lines,'1','Changed');
  if v_retry <> v_result then raise exception 'Checkout idempotency failed'; end if;
  select * into v_order from public.orders where id=(v_result->>'order_id')::uuid;
  if v_order.customer_name <> 'Customer snapshot' or v_order.customer_phone <> '0900123456' or v_order.customer_address <> 'Địa chỉ hóa đơn' then raise exception 'Snapshot mismatch'; end if;
  if (select stock from public.products where id=current_setting('test.product')::uuid) <> 9 then raise exception 'Retry changed stock'; end if;
  v_result := public.checkout_order(gen_random_uuid(),current_setting('test.price_list')::uuid,'',0,v_lines);
  select * into v_order from public.orders where id=(v_result->>'order_id')::uuid;
  if v_order.customer_name <> 'Khách lẻ' or v_order.customer_phone <> '' or v_order.customer_address <> '' then raise exception 'Legacy client compatibility failed'; end if;
end $$;
reset role;
rollback;
