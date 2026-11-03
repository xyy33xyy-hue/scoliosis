const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs');const assert=require('assert/strict');
const SHARED='00000000-0000-4000-8000-000000000111';
const OTHER='00000000-0000-4000-8000-000000000222';
module.exports=async function createFixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;grant usage on schema auth to anon,authenticated;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 insert into auth.users values('${SHARED}','2079700358@qq.com',now());
 `);
 // Use a UUID return cast, matching Supabase auth.uid().
 await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create schema storage;grant usage on schema storage to anon,authenticated;
 create table storage.buckets(id text primary key,public boolean);
 create table storage.objects(id uuid primary key,bucket_id text,name text);
 insert into storage.buckets values('gallery',true);
 alter table storage.objects enable row level security;
 grant select,insert,update,delete on storage.objects to authenticated,anon;
 create policy old_storage on storage.objects using(true) with check(true);
 create table public.patients(id text primary key,data jsonb not null,created_at timestamp default now());
 create table public.roster(id integer primary key,data jsonb not null);
 create table public.gallery(id text primary key,data jsonb not null,created_at timestamp default now());
 insert into public.patients(id,data) values('p1','{"id":"p1","name":"Fixture","cobb":5}');
 insert into public.roster values(1,'[{"name":"Fixture"}]');
 insert into public.gallery(id,data) values('g1','{"id":"g1","caption":"Fixture"}');
 grant usage on schema public to anon,authenticated;
 grant all on public.patients,public.roster,public.gallery to anon,authenticated;
 create publication supabase_realtime;
 `);
 await db.exec(fs.readFileSync(require('path').join(__dirname,'../supabase-auth-rls.sql'),'utf8'));
 await db.exec(fs.readFileSync(require('path').join(__dirname,'../supabase-sync.sql'),'utf8'));
 async function asRole(role,uid,fn){await db.exec('begin');try{await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role})]);await db.exec('set local role '+role);const r=await fn();await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
return {db,asRole,SHARED,OTHER};
};
