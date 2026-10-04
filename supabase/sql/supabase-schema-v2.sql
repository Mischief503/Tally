-- Tally: the multi-company database (schema v2).
-- Run this first, then supabase-twilio.sql. Safe to run again.
--
-- Tables
--   orgs             one row per company (join code, plan)
--   members          who belongs to which company, their role and the staff name they are
--   access_requests  people who asked to join with a code, waiting for the owner
--   docs             everything else the app keeps, one JSON document per path
--                    (jobs/…, shifts/…, vault/…, chat/…, locs/…, photos/…, formpages/…,
--                    org/settings, meta/init)
--
-- Roles: owner · dispatch · lead (crew lead) · crew. The rules live here, not just in the app.
--   owner     everything, and the only one who changes people, roles and company settings
--   dispatch  all jobs, schedule, payments, chat; not people or settings
--   lead      the jobs they are on, cards on file (to take payment), the crew's time clock
--   crew      the jobs they are on, their own time and location, chat, photos

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  join_code   text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  plan        text not null default 'trial',
  trial_ends  timestamptz not null default now() + interval '30 days',
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  org_id   uuid not null references public.orgs(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  email    text not null default '',
  staff    text not null default '',
  role     text not null default 'crew' check (role in ('owner','dispatch','lead','crew')),
  ts       bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (org_id, user_id)
);
create index if not exists members_user_idx on public.members(user_id);

create table if not exists public.access_requests (
  org_id   uuid not null references public.orgs(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  email    text not null default '',
  ts       bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (org_id, user_id)
);
create index if not exists access_requests_user_idx on public.access_requests(user_id);

create table if not exists public.docs (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  path        text not null,
  collection  text not null,
  doc_id      text not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (org_id, path),
  check (path = collection || '/' || doc_id),
  check (collection in ('org','meta','jobs','shifts','vault','chat','locs','photos','formpages'))
);
create index if not exists docs_collection_idx on public.docs(org_id, collection);
create index if not exists docs_move_date_idx on public.docs(org_id, ((data->'d'->>'moveDate'))) where collection = 'jobs';

-- ---------- who am I in this company (security definer, so the rules below never recurse) ----------
create or replace function public.role_in(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where org_id = o and user_id = auth.uid()
$$;
create or replace function public.staff_in(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select staff from public.members where org_id = o and user_id = auth.uid()
$$;
create or replace function public.member_of(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where org_id = o and user_id = auth.uid())
$$;
create or replace function public.office_of(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.role_in(o) in ('owner','dispatch'), false)
$$;
-- Is my staff name on this job's crew?
create or replace function public.on_job(o uuid, job jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_in(o) <> '' and (job->'assign'->'crew') ? public.staff_in(o), false)
$$;

-- ---------- company actions the app calls ----------
create or replace function public.new_join_code() returns text
language plpgsql volatile set search_path = public as $$
declare c text; abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.orgs where join_code = c);
  end loop;
  return c;
end $$;

-- Start a company; you become its owner. Returns the company id.
create or replace function public.create_org(company text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare o uuid; em text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if company is null or length(btrim(company)) = 0 then raise exception 'Give the company a name'; end if;
  if (select count(*) from public.orgs where created_by = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many new companies today';
  end if;
  select email into em from auth.users where id = auth.uid();
  insert into public.orgs(name, join_code, created_by) values (btrim(company), public.new_join_code(), auth.uid()) returning id into o;
  insert into public.members(org_id, user_id, email, staff, role) values (o, auth.uid(), coalesce(em, ''), '', 'owner');
  return o;
end $$;

-- Ask to join with a 6-character code. Returns the company name, or null if the code is wrong.
create or replace function public.request_join(code text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare o public.orgs; em text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into o from public.orgs where join_code = upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  if o.id is null then return null; end if;
  if exists (select 1 from public.members where org_id = o.id and user_id = auth.uid()) then return o.name; end if;
  select email into em from auth.users where id = auth.uid();
  insert into public.access_requests(org_id, user_id, email)
  values (o.id, auth.uid(), coalesce(em, ''))
  on conflict (org_id, user_id) do update set ts = excluded.ts;
  return o.name;
end $$;

-- The companies I'm in, and the ones I've asked to join.
create or replace function public.my_orgs()
returns table(id uuid, name text, role text, join_code text, pending boolean, plan text, trial_ends timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, m.role,
         case when m.role in ('owner','dispatch') then o.join_code else null end,
         false, o.plan, o.trial_ends
    from public.members m join public.orgs o on o.id = m.org_id
   where m.user_id = auth.uid()
  union all
  select o.id, o.name, '', null, true, o.plan, o.trial_ends
    from public.access_requests r join public.orgs o on o.id = r.org_id
   where r.user_id = auth.uid()
     and not exists (select 1 from public.members m where m.org_id = r.org_id and m.user_id = auth.uid())
  order by 2
$$;

-- Names for everyone in the company (and, for the owner, the people asking to join).
create or replace function public.people(o uuid)
returns table(user_id uuid, email text, role text, staff text)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.email, m.role, m.staff from public.members m
   where m.org_id = o and public.member_of(o)
  union all
  select r.user_id, r.email, 'request', '' from public.access_requests r
   where r.org_id = o and public.role_in(o) = 'owner'
     and not exists (select 1 from public.members m where m.org_id = o and m.user_id = r.user_id)
$$;

-- ---------- row level security ----------
alter table public.orgs            enable row level security;
alter table public.members         enable row level security;
alter table public.access_requests enable row level security;
alter table public.docs            enable row level security;

-- orgs: members read; the owner renames or deletes. New companies only through create_org().
drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs for select to authenticated using (public.member_of(id));
drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs for update to authenticated
  using (public.role_in(id) = 'owner') with check (public.role_in(id) = 'owner');
drop policy if exists orgs_delete on public.orgs;
create policy orgs_delete on public.orgs for delete to authenticated using (public.role_in(id) = 'owner');

-- members: everyone in the company sees the list; only the owner adds, changes or removes people,
-- and the owner can't remove or demote themselves (a company always keeps its owner).
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.member_of(org_id));
drop policy if exists members_write on public.members;
create policy members_write on public.members for insert to authenticated
  with check (public.role_in(org_id) = 'owner');
drop policy if exists members_update on public.members;
create policy members_update on public.members for update to authenticated
  using (public.role_in(org_id) = 'owner')
  with check (public.role_in(org_id) = 'owner' and (user_id <> auth.uid() or role = 'owner'));
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete to authenticated
  using (public.role_in(org_id) = 'owner' and user_id <> auth.uid());

-- access_requests: you see and withdraw your own; the owner sees and clears them.
drop policy if exists req_read on public.access_requests;
create policy req_read on public.access_requests for select to authenticated
  using (user_id = auth.uid() or public.role_in(org_id) = 'owner');
drop policy if exists req_insert on public.access_requests;
create policy req_insert on public.access_requests for insert to authenticated with check (user_id = auth.uid());
drop policy if exists req_update on public.access_requests;
create policy req_update on public.access_requests for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists req_delete on public.access_requests;
create policy req_delete on public.access_requests for delete to authenticated
  using (user_id = auth.uid() or public.role_in(org_id) = 'owner');

-- docs: by collection.
-- read
drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated using (
  public.member_of(org_id) and (
    public.office_of(org_id)
    or collection in ('org','meta','chat','locs','photos','formpages')
    or (collection = 'jobs'   and public.on_job(org_id, data))
    or (collection = 'vault'  and public.role_in(org_id) = 'lead')
    or (collection = 'shifts' and (public.role_in(org_id) = 'lead' or data->>'who' = public.staff_in(org_id)))
  ));

-- what a person may write, given the row as it would be saved
create or replace function public.can_write_doc(o uuid, col text, d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.member_of(o) then false
    when col in ('org','meta')   then public.role_in(o) = 'owner'
    when public.office_of(o)     then true
    when col = 'jobs'            then public.on_job(o, d)
    when col = 'vault'           then public.role_in(o) = 'lead'
    when col = 'shifts'          then public.role_in(o) = 'lead' or d->>'who' = public.staff_in(o)
    when col = 'locs'            then d->>'name' = public.staff_in(o)
    when col in ('chat','photos','formpages') then true
    else false end
$$;

-- insert: office creates jobs; crew can only "insert" a job that already lists them (the app
-- saves with an upsert, which Postgres checks as an insert first).
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated with check (
  public.can_write_doc(org_id, collection, data)
  and (collection <> 'jobs' or public.office_of(org_id)
       or exists (select 1 from public.docs x where x.org_id = docs.org_id and x.path = docs.path
                  and public.on_job(x.org_id, x.data))));

drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated
  using (public.can_write_doc(org_id, collection, data)
         or (collection = 'chat' and public.member_of(org_id) and data->>'from' = public.staff_in(org_id)))
  with check (public.can_write_doc(org_id, collection, data));

-- delete: office anything (owner only for settings); people clear their own location and
-- clock rows; anyone tidies photos and chat older than 60 days.
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated using (
  public.member_of(org_id) and (
    (public.office_of(org_id) and (collection not in ('org','meta') or public.role_in(org_id) = 'owner'))
    or (collection = 'locs'   and data->>'name' = public.staff_in(org_id))
    or (collection = 'shifts' and (public.role_in(org_id) = 'lead' or data->>'who' = public.staff_in(org_id)))
    or (collection = 'vault'  and public.role_in(org_id) = 'lead')
    or collection = 'photos'
    or (collection = 'chat' and ((jsonb_typeof(data->'ts') = 'number'
                                  and (data->>'ts')::numeric < extract(epoch from now() - interval '60 days') * 1000)
                                 or data->>'from' = public.staff_in(org_id)))
  ));

-- ---------- grants ----------
revoke all on public.orgs, public.members, public.access_requests, public.docs from anon;
grant select, update, delete on public.orgs to authenticated;
grant select, insert, update, delete on public.members, public.access_requests, public.docs to authenticated;
grant all on public.orgs, public.members, public.access_requests, public.docs to service_role;

revoke all on function public.role_in(uuid), public.staff_in(uuid), public.member_of(uuid), public.office_of(uuid),
  public.on_job(uuid, jsonb), public.can_write_doc(uuid, text, jsonb), public.new_join_code(),
  public.create_org(text), public.request_join(text), public.my_orgs(), public.people(uuid) from public, anon;
grant execute on function public.role_in(uuid), public.staff_in(uuid), public.member_of(uuid), public.office_of(uuid),
  public.on_job(uuid, jsonb), public.can_write_doc(uuid, text, jsonb),
  public.create_org(text), public.request_join(text), public.my_orgs(), public.people(uuid) to authenticated;

-- ---------- live updates ----------
alter table public.docs            replica identity full;
alter table public.members         replica identity full;
alter table public.access_requests replica identity full;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='docs') then
      alter publication supabase_realtime add table public.docs; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='members') then
      alter publication supabase_realtime add table public.members; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='access_requests') then
      alter publication supabase_realtime add table public.access_requests; end if;
  end if;
end $$;
