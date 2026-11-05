create table public.app_settings (
  setting_key text primary key
    check (setting_key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null,
  is_public boolean not null default false,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.app_settings (setting_key, value, is_public, is_default)
values ('store_name', to_jsonb('ERP'::text), true, true);

alter table public.app_settings enable row level security;

grant select on table public.app_settings to anon, authenticated;
grant insert, update, delete on table public.app_settings to authenticated;
grant select, insert, update, delete on table public.app_settings to service_role;

create policy app_settings_anon_read_public
  on public.app_settings for select to anon
  using (is_public);

create policy app_settings_authenticated_read_public
  on public.app_settings for select to authenticated
  using (is_public);

create policy app_settings_admin_read_all
  on public.app_settings for select to authenticated
  using ((select public.user_has_permission('accounts.manage')));

create policy app_settings_admin_insert
  on public.app_settings for insert to authenticated
  with check ((select public.user_has_permission('accounts.manage')));

create policy app_settings_admin_update
  on public.app_settings for update to authenticated
  using ((select public.user_has_permission('accounts.manage')))
  with check ((select public.user_has_permission('accounts.manage')));

create policy app_settings_admin_delete
  on public.app_settings for delete to authenticated
  using ((select public.user_has_permission('accounts.manage')));
