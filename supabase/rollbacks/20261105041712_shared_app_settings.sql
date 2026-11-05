-- Export these values before running this rollback after deployment. Dropping
-- the table removes the store name and all future shared settings.
drop table if exists public.app_settings;
