create table public.print_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null
    check (char_length(trim(name)) between 1 and 80),
  content text not null,
  paper_width_mm smallint not null default 80
    check (paper_width_mm in (58, 80, 210)),
  paper_orientation text not null default 'portrait'
    check (paper_orientation in ('portrait', 'landscape')),
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index print_templates_one_default_idx
  on public.print_templates (is_default)
  where is_default;

insert into public.print_templates (name, content, paper_width_mm, is_default)
values (
  'Mẫu in hóa đơn',
  E'# {{store.name}}\n\n**{{invoice.document_title}}**\\\n**Mã đơn:** {{invoice.order_no}}\\\n**Ngày:** {{invoice.created_at}}\n\n---\n\n**Tên KH:** {{invoice.customer_name}}\\\n**Địa chỉ:** {{invoice.customer_address}}\\\n**SĐT:** {{invoice.customer_phone}}\\\n**Thu ngân:** {{invoice.cashier_name}}\n\n{{invoice.items_table}}\n\n**Tổng tiền hàng:** {{invoice.subtotal}}\\\n**Giảm:** {{invoice.discount}}\\\n**Thanh toán:** {{invoice.total}}\n\n*Cảm ơn quý khách, hẹn gặp lại!*\n',
  80,
  true
);

alter table public.print_templates enable row level security;

grant select, insert, update, delete on table public.print_templates to authenticated;
grant select, insert, update, delete on table public.print_templates to service_role;

create policy print_templates_select
  on public.print_templates for select to authenticated
  using (
    (select public.user_has_permission('print_templates.read'))
    or (
      is_default
      and (
        (select public.user_has_permission('sales.create'))
        or (select public.user_has_permission('orders.read_own'))
        or (select public.user_has_permission('orders.read_all'))
      )
    )
  );

create policy print_templates_insert
  on public.print_templates for insert to authenticated
  with check (
    (select public.user_has_permission('print_templates.create'))
    and created_by = (select auth.uid())
  );

create policy print_templates_update
  on public.print_templates for update to authenticated
  using (
    (select public.user_has_permission('print_templates.read'))
    and (select public.user_has_permission('print_templates.update'))
  )
  with check (
    (select public.user_has_permission('print_templates.read'))
    and (select public.user_has_permission('print_templates.update'))
  );

create policy print_templates_delete
  on public.print_templates for delete to authenticated
  using (
    (select public.user_has_permission('print_templates.read'))
    and (select public.user_has_permission('print_templates.delete'))
    and not is_default
  );

create or replace function public.set_default_print_template(p_template_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.user_has_permission('print_templates.read')
    or not public.user_has_permission('print_templates.update') then
    raise insufficient_privilege using message = 'Missing print template update permission';
  end if;

  perform 1 from public.print_templates where id = p_template_id;
  if not found then
    raise exception 'Không tìm thấy mẫu in';
  end if;

  update public.print_templates
  set is_default = false,
      updated_at = now(),
      updated_by = auth.uid()
  where is_default and id <> p_template_id;

  update public.print_templates
  set is_default = true,
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_template_id;
end;
$$;

revoke all on function public.set_default_print_template(uuid) from public, anon;
grant execute on function public.set_default_print_template(uuid) to authenticated;

update public.roles as role
set permissions = array(
  select distinct permission
  from unnest(
    coalesce(role.permissions, array[]::text[]) || array[
      'print_templates.read',
      'print_templates.create',
      'print_templates.update',
      'print_templates.delete'
    ]::text[]
  ) as permission
  order by permission
)
where 'accounts.manage' = any(coalesce(role.permissions, array[]::text[]));
