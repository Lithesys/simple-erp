revoke all on function public.set_default_print_template(uuid) from public, anon, authenticated;
drop function if exists public.set_default_print_template(uuid);

drop table if exists public.print_templates;

update public.roles as role
set permissions = array(
  select role_permission.permission
  from unnest(coalesce(role.permissions, array[]::text[])) with ordinality
    as role_permission(permission, position)
  where role_permission.permission <> all(array[
    'print_templates.read',
    'print_templates.create',
    'print_templates.update',
    'print_templates.delete'
  ]::text[])
  order by role_permission.position
)
where coalesce(role.permissions, array[]::text[]) && array[
  'print_templates.read',
  'print_templates.create',
  'print_templates.update',
  'print_templates.delete'
]::text[];
