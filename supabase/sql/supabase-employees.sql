-- Tally: employee profiles with hiring info, sign-in by email, and private documents.
-- Run after supabase-schema-v2.sql. Safe to run again.
--
-- employees          one row per person who works for the company. `name` is the name Tally uses
--                    everywhere (jobs, chat, time clock); `email` is the address they sign in with;
--                    `info` holds the hiring details; `notes` are the owner's own and never shown to
--                    the employee. Only the owner reads or writes this table directly.
-- my_profile(o)      a person's own profile, without the owner's notes.
-- update_my_profile  a person changes their own phone, address, emergency contact or shirt size,
--                    and nothing else.
-- claim_invites()    runs right after sign-in. Every active profile whose email is the signed-in
--                    person's confirmed email is linked to them, and they join that company under
--                    that name and role. No join code, no approval step.
-- Triggers keep `members` (what the rules and the app use) in step with `employees`: the name and
-- role follow the profile; turning a profile off, deleting it or changing its email removes that
-- login's access; nobody can switch off their own access this way.
-- employee-docs      a private storage bucket, <company id>/<employee id>/<file>. The owner reads,
--                    adds and deletes everyone's files; each person reads and adds their own.
--
-- Not stored, on purpose: full Social Security numbers (only the last 4 go in `info`) and bank
-- account numbers. Those stay with the payroll company.

-- ---------- the table ----------
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  role        text not null default 'crew' check (role in ('owner','dispatch','lead','crew')),
  email       text not null default '',
  user_id     uuid references auth.users(id) on delete set null,
  active      boolean not null default true,
  info        jsonb not null default '{}'::jsonb check (jsonb_typeof(info) = 'object'),
  notes       text not null default '' check (length(notes) <= 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists employees_name_uq  on public.employees(org_id, lower(name));
create unique index if not exists employees_email_uq on public.employees(org_id, email) where email <> '';
create unique index if not exists employees_user_uq  on public.employees(org_id, user_id) where user_id is not null;
create index if not exists employees_email_idx on public.employees(email) where email <> '';

-- ---------- before saving: tidy the row, and only link a login that belongs here ----------
create or replace function public.employees_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name  := btrim(new.name);
  new.email := lower(btrim(coalesce(new.email, '')));
  if new.email <> '' and new.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right';
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then raise exception 'A profile cannot move to another company'; end if;
    -- a different sign-in email means a different person: the old login is unlinked
    if new.email is distinct from old.email and new.user_id is not distinct from old.user_id and new.user_id is not null
       and new.email <> coalesce((select lower(btrim(email)) from auth.users where id = new.user_id), '') then
      new.user_id := null;
    end if;
    if old.user_id = auth.uid() and not new.active then
      raise exception 'You can''t turn off your own access';
    end if;
  end if;
  -- a login can be linked by that person themselves (claim_invites), or by the owner when that
  -- person asked to join or is already in the company
  if new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    if not (new.user_id = auth.uid()
            or exists (select 1 from public.access_requests r where r.org_id = new.org_id and r.user_id = new.user_id)
            or exists (select 1 from public.members m where m.org_id = new.org_id and m.user_id = new.user_id)) then
      raise exception 'That person has not asked to join this company';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------- after saving: members follows the profile ----------
create or replace function public.employees_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare em text;
begin
  -- the login this profile had loses access when the profile is deleted, turned off or relinked
  if tg_op in ('UPDATE','DELETE') and old.user_id is not null
     and (tg_op = 'DELETE' or new.user_id is distinct from old.user_id or not new.active) then
    if old.user_id = auth.uid() then raise exception 'You can''t remove your own access'; end if;
    delete from public.members where org_id = old.org_id and user_id = old.user_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.user_id is not null and new.active then
    select coalesce(email, '') into em from auth.users where id = new.user_id;
    insert into public.members(org_id, user_id, email, staff, role)
    values (new.org_id, new.user_id, coalesce(em, ''), new.name, new.role)
    on conflict (org_id, user_id) do update
       set staff = excluded.staff,
           email = excluded.email,
           -- an owner never lowers their own role by editing their own profile
           role  = case when public.members.user_id = auth.uid() and public.members.role = 'owner'
                        then 'owner' else excluded.role end;
    delete from public.access_requests where org_id = new.org_id and user_id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists employees_check on public.employees;
create trigger employees_check before insert or update on public.employees
  for each row execute function public.employees_check();
drop trigger if exists employees_sync on public.employees;
create trigger employees_sync after insert or update or delete on public.employees
  for each row execute function public.employees_sync();

-- ---------- sign-in: link every profile that has my confirmed email ----------
create or replace function public.claim_invites() returns integer
language plpgsql volatile security definer set search_path = public as $$
declare em text; conf timestamptz; n integer := 0; e record;
begin
  if auth.uid() is null then return 0; end if;
  select lower(btrim(email)), email_confirmed_at into em, conf from auth.users where id = auth.uid();
  if coalesce(em, '') = '' or conf is null then return 0; end if;
  for e in
    select p.id from public.employees p
     where p.email = em and p.active and p.user_id is null
       and not exists (select 1 from public.employees x where x.org_id = p.org_id and x.user_id = auth.uid())
  loop
    update public.employees set user_id = auth.uid() where id = e.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- my own profile ----------
create or replace function public.my_profile(o uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'name', e.name, 'role', e.role, 'email', e.email,
                            'active', e.active, 'info', e.info, 'updated_at', e.updated_at)
    from public.employees e
   where e.org_id = o and e.user_id = auth.uid() and e.active
$$;

-- Change my own contact details. Anything else in the patch is ignored. A new phone number also
-- goes into the company's contact list, so Call buttons and texts reach the new number.
create or replace function public.update_my_profile(o uuid, patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare e public.employees; k text; v jsonb; clean jsonb := '{}'::jsonb;
  allowed text[] := array['phone','address','city','state','zip','emergencyName','emergencyRelation','emergencyPhone','shirtSize'];
begin
  select * into e from public.employees where org_id = o and user_id = auth.uid() and active;
  if e.id is null then raise exception 'No profile to update'; end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then raise exception 'Nothing to update'; end if;
  for k, v in select * from jsonb_each(patch) loop
    if k = any(allowed) and jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 200 then
      clean := clean || jsonb_build_object(k, btrim(v #>> '{}'));
    end if;
  end loop;
  update public.employees set info = info || clean where id = e.id;
  if clean ? 'phone' then
    update public.docs
       set data = jsonb_set(case when jsonb_typeof(data->'contacts') = 'object' then data
                                 else data || '{"contacts":{}}'::jsonb end,
                            array['contacts', e.name], to_jsonb(clean->>'phone'), true),
           updated_at = now()
     where org_id = o and path = 'org/settings';
  end if;
  return public.my_profile(o);
end $$;

-- ---------- row level security: the owner only; everyone else goes through the functions ----------
alter table public.employees enable row level security;
drop policy if exists emp_read on public.employees;
create policy emp_read on public.employees for select to authenticated using (public.role_in(org_id) = 'owner');
drop policy if exists emp_insert on public.employees;
create policy emp_insert on public.employees for insert to authenticated with check (public.role_in(org_id) = 'owner');
drop policy if exists emp_update on public.employees;
create policy emp_update on public.employees for update to authenticated
  using (public.role_in(org_id) = 'owner') with check (public.role_in(org_id) = 'owner');
drop policy if exists emp_delete on public.employees;
create policy emp_delete on public.employees for delete to authenticated using (public.role_in(org_id) = 'owner');

-- ---------- private documents ----------
-- Is this storage path <company>/<employee>/<file> one I may use? Owners: any employee of their
-- company (owner_only = true asks for that). Others: their own folder, while their profile is on.
create or replace function public.emp_doc_ok(path text, owner_only boolean default false) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p text[]; o uuid; e uuid;
  re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  p := string_to_array(coalesce(path, ''), '/');
  if coalesce(array_length(p, 1), 0) <> 3 or p[3] = '' or p[1] !~ re or p[2] !~ re then return false; end if;
  o := p[1]::uuid; e := p[2]::uuid;
  if not exists (select 1 from public.employees where id = e and org_id = o) then return false; end if;
  if public.role_in(o) = 'owner' then return true; end if;
  if owner_only then return false; end if;
  return exists (select 1 from public.employees where id = e and org_id = o and user_id = auth.uid() and active);
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-docs', 'employee-docs', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tally_emp_docs_read on storage.objects;
create policy tally_emp_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'employee-docs' and public.emp_doc_ok(name));
drop policy if exists tally_emp_docs_add on storage.objects;
create policy tally_emp_docs_add on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-docs' and public.emp_doc_ok(name));
drop policy if exists tally_emp_docs_delete on storage.objects;
create policy tally_emp_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-docs' and public.emp_doc_ok(name, true));

-- ---------- grants ----------
revoke all on public.employees from anon;
grant select, insert, update, delete on public.employees to authenticated;
grant all on public.employees to service_role;
revoke all on function public.employees_check(), public.employees_sync() from public, anon, authenticated;
revoke all on function public.claim_invites(), public.my_profile(uuid), public.update_my_profile(uuid, jsonb),
  public.emp_doc_ok(text, boolean) from public, anon;
grant execute on function public.claim_invites(), public.my_profile(uuid), public.update_my_profile(uuid, jsonb),
  public.emp_doc_ok(text, boolean) to authenticated;
