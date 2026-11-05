-- Local product search calls extensions.unaccent as the authenticated role.
-- Permit the already-granted search functions to resolve that extension schema.
grant usage on schema extensions to authenticated, service_role;
