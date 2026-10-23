-- tests/sql/callcenter.sh: a database as it was before the call center (commit ab624a2, Oct 21, 2026, which
-- is what the live database has), made from one set up with today's files: the constraint, rules, company
-- list and job guard as they were, and none of the call center's own tables, functions, triggers or copies.
-- supabase-callcenter.sql then has to bring it to exactly what today's files make.
delete from public.docs where collection in ('sched','ratecard');
drop trigger if exists sched_sync on public.docs;
drop trigger if exists sched_gone on public.docs;
drop function if exists public.sched_sync();
drop function if exists public.sched_of(jsonb);
drop trigger if exists ratecard_sync on public.docs;
drop trigger if exists ratecard_gone on public.docs;
drop function if exists public.ratecard_sync();
drop function if exists public.ratecard_of(jsonb);
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
drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs for select to authenticated using (public.member_of(id));
alter table public.docs drop constraint if exists docs_collection_check;
alter table public.docs add constraint docs_collection_check
  check (collection in ('org','meta','jobs','shifts','vault','chat','locs','photos','formpages'));
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

create or replace function public.jobs_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare k text; v jsonb; ov jsonb; pays jsonb; olds jsonb;
begin
  if auth.uid() is null then return new; end if;   -- the server (service role) and the SQL editor
  if not public.office_of(new.org_id) and (new.data -> 'quote') is distinct from (old.data -> 'quote') then
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
drop function if exists public.cc_save(uuid, text, jsonb, jsonb);
drop function if exists public.cc_clean(jsonb, boolean);
drop function if exists public.cc_open(jsonb);
drop function if exists public.cc_in(uuid);
drop function if exists public.cc_agent();
drop function if exists public.claim_cc_team();
drop function if exists public.cc_me();
drop table if exists public.tally_cc_team;
drop table if exists public.cc_orgs;
