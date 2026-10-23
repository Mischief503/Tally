-- Tally: the call center (October 22, 2026). Run after supabase-schema-v2.sql, supabase-employees.sql and
-- supabase-payments.sql, in the SQL editor. Safe to run again. Nothing here removes or rewrites your jobs,
-- people or settings.
--
-- What it adds:
--   * the role 'callcenter' for people (company members and employee profiles)
--   * the call center reads the open quotes and leads, and the schedule as a copy without the money
--     (sched/<job id>, kept by the trigger sched_sync on every save of a job)
--   * it writes only open quotes: changing one, booking it (its last change) or marking it lost. A new
--     quote has no payment and no discount, and the job guard keeps a discount the office gave, and every
--     payment, as they were
-- The same blocks are in supabase-schema-v2.sql, supabase-employees.sql and supabase-payments.sql (between
-- the "-- @cc" lines), so running those files again keeps the call center. This file is written from them
-- by scripts/cc_sql.py; change them, then run it.

-- ---------- members-role (as in supabase-schema-v2.sql) ----------
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('owner','dispatch','callcenter','lead','crew'));

-- ---------- docs-collections (as in supabase-schema-v2.sql) ----------
alter table public.docs drop constraint if exists docs_collection_check;
alter table public.docs add constraint docs_collection_check
  check (collection in ('org','meta','jobs','shifts','vault','chat','locs','photos','formpages','sched'));

-- ---------- helpers (as in supabase-schema-v2.sql) ----------
-- Am I the call center here? A job it may read and change is an open quote or lead; what it saves is a
-- quote, a booking or a lost quote, and a new one has no payment and no discount (the job guard keeps a
-- discount the office gave, and the payments, as they were).
create or replace function public.cc_in(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.role_in(o) = 'callcenter', false)
$$;
create or replace function public.cc_open(d jsonb) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(d->>'status', '') in ('lead','quoted')
$$;
create or replace function public.cc_clean(d jsonb, fresh boolean) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(d->>'status', '') in ('lead','quoted','booked','lost')
     and (not fresh or (coalesce(d->'payments', '{}'::jsonb) in ('{}'::jsonb, '[]'::jsonb)
                        and coalesce(nullif(btrim(d->'d'->>'discount'), ''), '0') ~ '^0*(\.0*)?$'))
$$;
revoke all on function public.cc_in(uuid), public.cc_open(jsonb), public.cc_clean(jsonb, boolean) from public, anon;
grant execute on function public.cc_in(uuid), public.cc_open(jsonb), public.cc_clean(jsonb, boolean) to authenticated;

-- ---------- docs-rules (as in supabase-schema-v2.sql) ----------
-- docs: by collection.
-- read. The call center reads the company's settings, its open quotes and the schedule's copies, and
-- nothing of the team's own: not the chat, the crew's locations, the job photos or the forms' pages.
drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated using (
  public.member_of(org_id) and (
    public.office_of(org_id)
    or collection in ('org','meta')
    or (collection in ('chat','locs','photos','formpages') and not public.cc_in(org_id))
    or (collection = 'jobs'   and public.on_job(org_id, data))
    or (collection = 'jobs'   and public.cc_in(org_id) and public.cc_open(data))
    or (collection = 'sched'  and public.cc_in(org_id))
    or (collection = 'vault'  and public.role_in(org_id) = 'lead')
    or (collection = 'shifts' and (public.role_in(org_id) = 'lead' or data->>'who' = public.staff_in(org_id)))
  ));

-- what a person may write, given the row as it would be saved. 'sched' is the database's own, and
-- the call center writes only through cc_save (supabase-payments.sql), which checks what it saves:
-- a row rule couldn't let it book a quote, since a booked job is one it can't read.
create or replace function public.can_write_doc(o uuid, col text, d jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.member_of(o) then false
    when col in ('org','meta')   then public.role_in(o) = 'owner'
    when col = 'sched'           then false
    when public.office_of(o)     then true
    when public.cc_in(o)         then false
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

-- ---------- sched (as in supabase-schema-v2.sql) ----------
-- The schedule without the money, for the call center: every booked or in-progress job is copied to
-- sched/<id> with the customer, the day and time, the addresses, the items, the crew size, the
-- estimate and the trucks; never the price, the payments or the bill. Kept by a trigger on every
-- save of a job (any role, or the server), and gone when the job is finished, lost or deleted.
create or replace function public.sched_of(j jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'id', j->'id', 'status', j->'status', 'test', coalesce(j->'test', 'false'::jsonb),
    'd', jsonb_build_object('name', j->'d'->'name', 'phone', j->'d'->'phone', 'email', j->'d'->'email',
           'moveDate', j->'d'->'moveDate', 'time', j->'d'->'time', 'from', j->'d'->'from', 'to', j->'d'->'to',
           'notes', j->'d'->'notes', 'flights', j->'d'->'flights', 'custom', j->'d'->'custom'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i->'id', 'name', i->'name', 'qty', i->'qty'))
                         from jsonb_array_elements(case when jsonb_typeof(j->'items') = 'array' then j->'items' else '[]'::jsonb end) i),
                      '[]'::jsonb),
    'quote', jsonb_build_object('crew', j->'quote'->'crew', 'hours', j->'quote'->'hours', 'kind', j->'quote'->'kind',
           'driveH', j->'quote'->'driveH', 'nTrucks', j->'quote'->'nTrucks', 'truckId', j->'quote'->'truckId',
           'truckName', j->'quote'->'truckName'),
    'assign', jsonb_build_object('truckId', j->'assign'->'truckId', 'more', coalesce(j->'assign'->'more', '[]'::jsonb),
           'crewN', case when jsonb_typeof(j->'assign'->'crew') = 'array' then jsonb_array_length(j->'assign'->'crew') else 0 end),
    'startedAt', j->'startedAt')
$$;
create or replace function public.sched_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.docs where org_id = old.org_id and path = 'sched/' || old.doc_id;
    return old;
  end if;
  if coalesce(new.data->>'status', '') in ('booked','active') then
    insert into public.docs(org_id, path, collection, doc_id, data, updated_at)
    values (new.org_id, 'sched/' || new.doc_id, 'sched', new.doc_id, public.sched_of(new.data), now())
    on conflict (org_id, path) do update set data = excluded.data, updated_at = excluded.updated_at
      where public.docs.data is distinct from excluded.data;
  else
    delete from public.docs where org_id = new.org_id and path = 'sched/' || new.doc_id;
  end if;
  return new;
end $$;
revoke all on function public.sched_of(jsonb), public.sched_sync() from public, anon, authenticated;
drop trigger if exists sched_sync on public.docs;
create trigger sched_sync after insert or update on public.docs
  for each row when (new.collection = 'jobs') execute function public.sched_sync();
drop trigger if exists sched_gone on public.docs;
create trigger sched_gone after delete on public.docs
  for each row when (old.collection = 'jobs') execute function public.sched_sync();
-- the copies for the jobs already there, and none for a job that's no longer on the schedule
insert into public.docs(org_id, path, collection, doc_id, data, updated_at)
select org_id, 'sched/' || doc_id, 'sched', doc_id, public.sched_of(data), now() from public.docs
 where collection = 'jobs' and coalesce(data->>'status', '') in ('booked','active')
on conflict (org_id, path) do update set data = excluded.data, updated_at = excluded.updated_at
  where public.docs.data is distinct from excluded.data;
delete from public.docs s where s.collection = 'sched' and not exists (
  select 1 from public.docs j where j.org_id = s.org_id and j.path = 'jobs/' || s.doc_id
     and coalesce(j.data->>'status', '') in ('booked','active'));

-- ---------- employees-role (as in supabase-employees.sql) ----------
do $$ begin
  if to_regclass('public.employees') is not null then
    alter table public.employees drop constraint if exists employees_role_check;
    alter table public.employees add constraint employees_role_check check (role in ('owner','dispatch','callcenter','lead','crew'));
  end if;
end $$;

-- ---------- jobs-guard (as in supabase-payments.sql) ----------
create or replace function public.jobs_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare k text; v jsonb; ov jsonb; pays jsonb; olds jsonb; cc boolean;
begin
  if auth.uid() is null then return new; end if;   -- the server (service role) and the SQL editor
  -- the call center prices an open quote (the row rules let it change nothing else), but gives no
  -- discount of its own and never touches a payment
  cc := public.cc_in(new.org_id) and public.cc_open(old.data);
  if cc then
    if coalesce(nullif(btrim(new.data->'d'->>'discount'), ''), '0') is distinct from coalesce(nullif(btrim(old.data->'d'->>'discount'), ''), '0') then
      raise exception 'Only the office gives a discount';
    end if;
    if coalesce(new.data->'payments', '{}'::jsonb) is distinct from coalesce(old.data->'payments', '{}'::jsonb) then
      raise exception 'The call center doesn''t take payments';
    end if;
  end if;
  if not public.office_of(new.org_id) and not cc and (new.data -> 'quote') is distinct from (old.data -> 'quote') then
    new.data := case when old.data ? 'quote' then jsonb_set(new.data, '{quote}', old.data -> 'quote') else new.data - 'quote' end;
  end if;
  if not public.office_of(new.org_id) and (new.data -> 'quoteHist') is distinct from (old.data -> 'quoteHist') then
    new.data := case when old.data ? 'quoteHist' then jsonb_set(new.data, '{quoteHist}', old.data -> 'quoteHist') else new.data - 'quoteHist' end;
  end if;
  pays := case when jsonb_typeof(new.data -> 'payments') = 'object' then new.data -> 'payments' else '{}'::jsonb end;
  olds := case when jsonb_typeof(old.data -> 'payments') = 'object' then old.data -> 'payments' else '{}'::jsonb end;
  for k, v in select key, value from jsonb_each(pays) loop
    ov := olds -> k;
    if v is not distinct from ov then continue; end if;
    if k ~ '^(st|rf|dp)_'
       or jsonb_typeof(v) is distinct from 'object'
       or v ? 'stripe'
       or (case when jsonb_typeof(v -> 'amt') = 'number' then (v ->> 'amt')::numeric <= 0 else true end) then
      pays := case when ov is null then pays - k else jsonb_set(pays, array[k], ov) end;
    end if;
  end loop;
  for k, ov in select key, value from jsonb_each(olds) loop
    if (k ~ '^(st|rf|dp)_' or (jsonb_typeof(ov) = 'object' and ov ? 'stripe')) and not (pays ? k) then
      pays := jsonb_set(pays, array[k], ov);
    end if;
  end loop;
  if pays is distinct from (new.data -> 'payments') and (pays <> '{}'::jsonb or new.data ? 'payments') then
    new.data := jsonb_set(new.data, '{payments}', pays);
  end if;
  return new;
end $$;
create or replace trigger jobs_guard before update on public.docs
  for each row when (new.collection = 'jobs') execute function public.jobs_guard();
-- The call center saves jobs only through here (the app does it for them): a new quote or booking with
-- no payment and no discount, or a change to an open quote: its price (the job guard keeps the office's
-- discount and the payments as they were), booking it or marking it lost, each the last change it makes.
-- 'ok'; 'missing' (a change to a job that isn't there); 'closed' (booked or closed meanwhile, so no
-- longer the call center's).
create or replace function public.cc_save(o uuid, p text, doc jsonb, patch jsonb) returns text
language plpgsql volatile security definer set search_path = public as $$
declare cur jsonb; nd jsonb;
begin
  if not public.cc_in(o) then raise exception 'Only the call center saves jobs this way'; end if;
  if p is null or p !~ '^jobs/[A-Za-z0-9_-]{1,64}$' then raise exception 'The call center saves jobs only'; end if;
  select data into cur from public.docs where org_id = o and path = p for update;
  if found then
    if not public.cc_open(cur) then return 'closed'; end if;
    nd := case when patch is not null then public.jsonb_merge_patch(cur, patch) else doc end;
    if nd is null or jsonb_typeof(nd) <> 'object' or not public.cc_clean(nd, false) then
      raise exception 'The call center saves quotes, bookings and lost quotes';
    end if;
    update public.docs set data = nd, updated_at = now() where org_id = o and path = p;
  else
    if patch is not null then return 'missing'; end if;
    if doc is null or jsonb_typeof(doc) <> 'object' or not public.cc_clean(doc, true) then
      raise exception 'A new job from the call center is a quote or a booking, with no payment and no discount';
    end if;
    insert into public.docs(org_id, path, collection, doc_id, data, updated_at) values (o, p, 'jobs', substr(p, 6), doc, now());
  end if;
  return 'ok';
end $$;
revoke all on function public.cc_save(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.cc_save(uuid, text, jsonb, jsonb) to authenticated;
