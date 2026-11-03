-- Run only after backup and preflight. Targets the exact tables/bucket used by screening-2.
-- Does not modify patient rows or delete existing policies. Transaction aborts on missing prerequisites.
begin;
do $migration$
declare
  shared_uid uuid;
  t text;
  allowed text;
begin
  if (select count(*) from auth.users where lower(email)='2079700358@qq.com'
      and email_confirmed_at is not null) <> 1 then
    raise exception 'Create and confirm exactly one shared Auth user first';
  end if;
  select id into strict shared_uid from auth.users
    where lower(email)='2079700358@qq.com' and email_confirmed_at is not null;
  allowed := format('(select auth.uid()) = %L::uuid',shared_uid);
  foreach t in array array['patients','roster','gallery'] loop
    if not exists(select 1 from information_schema.columns where table_schema='public'
       and table_name=t and column_name='id') or not exists(
       select 1 from information_schema.columns where table_schema='public'
       and table_name=t and column_name='data' and data_type in ('json','jsonb')) then
      raise exception 'Expected public.%(id,data json/jsonb); inspect schema before proceeding',t;
    end if;
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on table public.%I from anon, public',t);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',t);
    execute format('drop policy if exists scoli_shared_guard_v1 on public.%I',t);
    execute format('drop policy if exists scoli_shared_access_v1 on public.%I',t);
    -- Restrictive AND guard also constrains any old permissive allow-all policy.
    execute format('create policy scoli_shared_guard_v1 on public.%I as restrictive for all to public using (%s) with check (%s)',t,allowed,allowed);
    execute format('create policy scoli_shared_access_v1 on public.%I for all to authenticated using (%s) with check (%s)',t,allowed,allowed);
  end loop;
  if not exists(select 1 from storage.buckets where id='gallery') then
    raise exception 'Expected gallery storage bucket is missing';
  end if;
  update storage.buckets set public=false where id='gallery';
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'storage.objects RLS must be enabled; inspect Storage configuration';
  end if;
  drop policy if exists scoli_gallery_guard_v1 on storage.objects;
  drop policy if exists scoli_gallery_access_v1 on storage.objects;
  -- Leave other buckets governed by their existing policies; protect every gallery object.
  execute format($policy$
    create policy scoli_gallery_guard_v1 on storage.objects as restrictive for all to public
    using (bucket_id <> 'gallery' or (%s and name ~ '^photos/[A-Za-z0-9_.-]+$'))
    with check (bucket_id <> 'gallery' or (%s and name ~ '^photos/[A-Za-z0-9_.-]+$'))
  $policy$,allowed,allowed);
  execute format($policy$
    create policy scoli_gallery_access_v1 on storage.objects for all to authenticated
    using (bucket_id='gallery' and %s and name ~ '^photos/[A-Za-z0-9_.-]+$')
    with check (bucket_id='gallery' and %s and name ~ '^photos/[A-Za-z0-9_.-]+$')
  $policy$,allowed,allowed);
end
$migration$;
commit;
