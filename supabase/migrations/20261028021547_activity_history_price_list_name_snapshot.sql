-- Store the name of the price list in the audit snapshot when a selling price changes.
create or replace function public.log_activity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_changed jsonb;
  v_id text;
  v_label text;
  v_actor_name text;
  v_action text;
  v_product_id uuid;
  v_product_name text;
  v_price_list_name text;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Stock is audited from inventory_movements so a sale, purchase, or stock
  -- check creates one inventory record rather than a duplicate product update.
  if tg_table_name = 'products' then
    v_old := v_old - 'stock' - 'created_at' - 'updated_at';
    v_new := v_new - 'stock' - 'created_at' - 'updated_at';
  else
    v_old := v_old - 'created_at' - 'updated_at';
    v_new := v_new - 'created_at' - 'updated_at';
  end if;

  select coalesce(jsonb_object_agg(changed.key, jsonb_build_object(
    'before', changed.old_value,
    'after', changed.new_value
  )), '{}'::jsonb)
  into v_changed
  from (
    select coalesce(n.key, o.key) as key, o.value as old_value, n.value as new_value
    from jsonb_each(v_old) o
    full join jsonb_each(v_new) n using (key)
    where o.value is distinct from n.value
      and coalesce(n.key, o.key) not in (
        'id', 'product_id', 'bundle_product_id', 'order_id', 'purchase_order_id',
        'stock_check_id', 'customer_id', 'price_list_id', 'cashier_id', 'created_by',
        'received_by', 'cancelled_by', 'idempotency_key'
      )
  ) changed;

  if v_changed = '{}'::jsonb then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'product_prices'
    and tg_op = 'UPDATE'
    and v_changed ? 'price' then
    select pl.name into v_price_list_name
    from public.price_lists pl
    where pl.id = coalesce(
      nullif(v_new->>'price_list_id', '')::uuid,
      nullif(v_old->>'price_list_id', '')::uuid
    );

    if v_price_list_name is not null then
      v_changed := jsonb_set(
        v_changed,
        '{price_list_name}',
        jsonb_build_object('before', null, 'after', v_price_list_name),
        true
      );
    end if;
  end if;

  v_id := coalesce(
    v_new->>'id', v_old->>'id', v_new->>'bundle_product_id',
    v_old->>'bundle_product_id', v_new->>'product_id', v_old->>'product_id'
  );
  v_product_id := coalesce(
    case when tg_table_name = 'product_bundle_items' then
      coalesce(nullif(v_new->>'bundle_product_id', '')::uuid, nullif(v_old->>'bundle_product_id', '')::uuid)
    end,
    nullif(v_new->>'product_id', '')::uuid,
    nullif(v_old->>'product_id', '')::uuid,
    case when tg_table_name = 'products' then nullif(v_id, '')::uuid end
  );
  v_label := coalesce(
    nullif(v_new->>'order_no', ''), nullif(v_old->>'order_no', ''),
    nullif(v_new->>'purchase_no', ''), nullif(v_old->>'purchase_no', ''),
    nullif(v_new->>'sku', ''), nullif(v_old->>'sku', ''),
    nullif(v_new->>'product_name', ''), nullif(v_old->>'product_name', ''),
    nullif(v_new->>'name', ''), nullif(v_old->>'name', ''),
    nullif(v_new->>'debt_item', ''), nullif(v_old->>'debt_item', ''),
    v_id, ''
  );
  if tg_table_name = 'order_items' then
    v_label := coalesce(
      nullif(v_new->>'product_name', ''),
      nullif(v_old->>'product_name', ''),
      v_label
    );
  elsif v_product_id is not null and tg_table_name <> 'products' then
    select coalesce(nullif(p.sku, ''), p.name) into v_label
    from public.products p where p.id = v_product_id;
    v_label := coalesce(v_label, '');
  end if;

  select p.name into v_product_name
  from public.products p where p.id = v_product_id;
  v_product_name := coalesce(
    nullif(v_new->>'product_name', ''),
    nullif(v_old->>'product_name', ''),
    nullif(v_new->>'name', ''),
    nullif(v_old->>'name', ''),
    v_product_name
  );
  v_action := case tg_op
    when 'INSERT' then 'Tạo'
    when 'DELETE' then 'Xóa'
    else 'Cập nhật'
  end;
  if tg_table_name in ('orders', 'purchase_orders') and tg_op = 'UPDATE' then
    if v_old->>'status' is distinct from v_new->>'status' and v_new->>'status' = 'cancelled' then
      v_action := 'Hủy';
    elsif tg_table_name = 'purchase_orders'
      and v_old->>'status' is distinct from v_new->>'status'
      and v_new->>'status' = 'received' then
      v_action := 'Hoàn thành';
    end if;
  end if;
  if tg_table_name = 'products' and tg_op = 'UPDATE'
    and v_old->>'is_active' = 'true' and v_new->>'is_active' = 'false' then
    v_action := 'Ngừng kinh doanh';
  end if;

  select coalesce(nullif(p.display_name, ''), p.username, 'Tài khoản')
  into v_actor_name from public.profiles p where p.id = auth.uid();
  insert into public.activity_history (
    operation_id, actor_id, actor_name, feature, action,
    entity_type, entity_id, entity_label, product_name, related_entity_id, changed_fields
  ) values (
    pg_current_xact_id()::text, auth.uid(), coalesce(v_actor_name, 'Tài khoản'),
    tg_argv[0], v_action, tg_argv[1], coalesce(v_id, ''), v_label, v_product_name,
    case
      when tg_table_name = 'order_items' then coalesce(
        nullif(v_new->>'order_id', ''), nullif(v_old->>'order_id', '')
      )
      when tg_table_name = 'purchase_order_items' then coalesce(
        nullif(v_new->>'purchase_order_id', ''),
        nullif(v_old->>'purchase_order_id', '')
      )
      else v_product_id::text
    end,
    v_changed
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.log_activity_change() from public, anon, authenticated;
