-- Read-only inventory. Run as project owner in SQL Editor. No patient rows selected.
select table_schema,table_name,column_name,data_type
from information_schema.columns
where table_schema='public' and table_name in ('patients','roster','gallery')
order by table_name,ordinal_position;
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('patients','roster','gallery');
select * from pg_policies where (schemaname='public' and tablename in ('patients','roster','gallery'))
or (schemaname='storage' and tablename='objects');
select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id='gallery';
select id,email,email_confirmed_at from auth.users where lower(email)='2079700358@qq.com';
-- Inspect API-exposed views, functions, other tables and grants as well. They may bypass these policies.
select table_schema,table_name from information_schema.views where table_schema='public';
select routine_schema,routine_name,security_type from information_schema.routines where routine_schema='public';
