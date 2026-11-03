-- Additive rollout. Existing records and Storage objects are preserved.
alter table public.patients add column version bigint not null default 1 check (version > 0);
alter table public.roster add column version bigint not null default 1 check (version > 0);
alter table public.gallery add column version bigint not null default 1 check (version > 0);
create table public.scoli_sync_state (
  id boolean primary key default true check (id),
  version bigint not null default 1 check (version > 0)
);
insert into public.scoli_sync_state(id) values(true);
alter table public.scoli_sync_state enable row level security;
alter table public.scoli_sync_state force row level security;
revoke all on public.scoli_sync_state from public,anon,authenticated;
grant select,update on public.scoli_sync_state to authenticated;
do $policies$
declare shared_uid uuid; predicate text;
begin
  select id into strict shared_uid from auth.users
    where lower(email)='2079700358@qq.com' and email_confirmed_at is not null;
  predicate:=format('(select auth.uid()) = %L::uuid',shared_uid);
  execute format('create policy scoli_sync_shared_access on public.scoli_sync_state for all to authenticated using (%s) with check (%s)',predicate,predicate);
end
$policies$;

create function public.scoli_write_guard() returns trigger
language plpgsql security invoker set search_path='' as $guard$
begin
  if current_user in ('postgres','service_role','supabase_admin') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if current_setting('scoli.commit_guard',true) is distinct from 'v1' then
    raise exception using errcode='40001',message='CLIENT_UPGRADE_REQUIRED';
  end if;
  if tg_op='UPDATE' and new.version <> old.version+1 then
    raise exception using errcode='40001',message='VERSION_CONFLICT';
  end if;
  if tg_op='INSERT' and new.version <> 1 then
    raise exception using errcode='40001',message='INVALID_INITIAL_VERSION';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end
$guard$;
revoke all on function public.scoli_write_guard() from public,anon,authenticated;
create trigger scoli_guard before insert or update or delete on public.patients for each row execute function public.scoli_write_guard();
create trigger scoli_guard before insert or update or delete on public.roster for each row execute function public.scoli_write_guard();
create trigger scoli_guard before insert or update or delete on public.gallery for each row execute function public.scoli_write_guard();
create trigger scoli_guard before update on public.scoli_sync_state for each row execute function public.scoli_write_guard();

-- A single SQL statement sees one coherent MVCC snapshot, including its revision.
create function public.scoli_snapshot() returns jsonb
language sql stable security invoker set search_path='' as $snapshot$
  select jsonb_build_object(
    'revision',s.version,
    'patients',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'data',p.data,'version',p.version) order by p.id),'[]'::jsonb) from public.patients p),
    'roster',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'data',r.data,'version',r.version) order by r.id),'[]'::jsonb) from public.roster r),
    'gallery',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'data',g.data,'version',g.version) order by g.id),'[]'::jsonb) from public.gallery g)
  ) from public.scoli_sync_state s where s.id=true;
$snapshot$;
revoke all on function public.scoli_snapshot() from public,anon;
grant execute on function public.scoli_snapshot() to authenticated;

create function public.scoli_commit(p_changes jsonb,p_expected_revision bigint default null) returns jsonb
language plpgsql security invoker set search_path='' as $commit$
declare ch jsonb; tbl text; key text; expected bigint; actual bigint; rev bigint; affected integer; applied integer:=0; previous_guard text;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>5000 then
    raise exception 'INVALID_BATCH';
  end if;
  -- Serialize app commits so batches and global-revision checks are atomic.
  perform pg_advisory_xact_lock(5839142071::bigint);
  select version into rev from public.scoli_sync_state where id=true for update;
  if not found then raise insufficient_privilege using message='NOT_AUTHORIZED'; end if;
  if p_expected_revision is not null and p_expected_revision<>rev then
    raise exception using errcode='40001',message='BATCH_VERSION_CONFLICT';
  end if;
  previous_guard:=current_setting('scoli.commit_guard',true);
  perform set_config('scoli.commit_guard','v1',true);
  for ch in select value from jsonb_array_elements(p_changes) loop
    tbl:=ch->>'table'; key:=ch->>'id'; expected:=(ch->>'expected')::bigint;
    if tbl not in ('patients','roster','gallery') or tbl is null or key is null or length(key)>200
      or ch->>'op' not in ('put','delete') or ch->>'op' is null or expected is null or expected<0 then
      raise exception 'INVALID_CHANGE';
    end if;
    if ch->>'op'='put' and (not ch ? 'data' or ch->'data'='null'::jsonb) then raise exception 'MISSING_DATA'; end if;
    actual:=null;
    execute format('select version from public.%I where id::text=$1 for update',tbl) into actual using key;
    if coalesce(actual,0)<>expected then
      raise exception using errcode='40001',message='ROW_VERSION_CONFLICT';
    end if;
    if ch->>'op'='delete' then
      if actual is null then raise exception using errcode='40001',message='ROW_VERSION_CONFLICT'; end if;
      execute format('delete from public.%I where id::text=$1 and version=$2',tbl) using key,expected;
    elsif actual is null then
      if tbl='roster' then
        execute 'insert into public.roster(id,data,version) values($1::integer,$2,1)' using key,ch->'data';
      else
        execute format('insert into public.%I(id,data,version) values($1,$2,1)',tbl) using key,ch->'data';
      end if;
    else
      execute format('update public.%I set data=$1,version=version+1 where id::text=$2 and version=$3',tbl) using ch->'data',key,expected;
    end if;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception using errcode='40001',message='ROW_VERSION_CONFLICT'; end if;
    applied:=applied+1;
  end loop;
  if applied>0 then update public.scoli_sync_state set version=version+1 where id=true returning version into rev; end if;
  perform set_config('scoli.commit_guard',coalesce(previous_guard,''),true);
  return jsonb_build_object('revision',rev,'applied',applied);
end
$commit$;
revoke all on function public.scoli_commit(jsonb,bigint) from public,anon;
grant execute on function public.scoli_commit(jsonb,bigint) to authenticated;

-- Only the non-clinical revision is replicated, not patient rows or photos.
do $realtime$
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    raise exception 'Expected supabase_realtime publication';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='scoli_sync_state') then
    alter publication supabase_realtime add table public.scoli_sync_state;
  end if;
end
$realtime$;
