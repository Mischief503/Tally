-- Tally — texts, masked calls and the call/text log
-- Run this once in Supabase › SQL Editor, AFTER supabase-schema-v2.sql.
-- It only adds three tables and one helper; nothing existing is changed.
--
--   comm_lines      which Twilio number belongs to which company. YOU fill this in (Table Editor),
--                   the app can only read it. Any signed-in person can start a company in Tally,
--                   so this is what stops a stranger's company from using your Twilio account.
--   comm_log        every text and call, against the job. Owner and dispatch see all of them;
--                   everyone else sees only their own.
--   comm_job_state  what was last texted about each job, so nobody gets the same text twice.
--                   Only the Edge Function touches it.

do $$
declare
  org_t text;
begin
  -- match whatever type the company id already has (uuid or text) so the rules compare cleanly
  select format_type(a.atttypid, a.atttypmod) into org_t
  from pg_attribute a
  where a.attrelid = 'public.members'::regclass and a.attname = 'org_id' and not a.attisdropped;
  if org_t is null then raise exception 'Run supabase-schema-v2.sql first (public.members is missing)'; end if;

  execute format($t$
    create table if not exists public.comm_lines (
      org_id       %1$s primary key,
      phone_number text not null unique check (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
      enabled      boolean not null default true,
      created_at   timestamptz not null default now()
    )$t$, org_t);

  execute format($t$
    create table if not exists public.comm_log (
      id           bigint generated always as identity primary key,
      org_id       %1$s not null,
      job_id       text,
      channel      text not null check (channel in ('sms','call')),
      direction    text not null check (direction in ('out','in')),
      purpose      text not null,
      staff        text,
      party        text,
      to_number    text,
      from_number  text,
      body         text,
      sid          text,
      status       text,
      error        text,
      duration_sec integer,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now()
    )$t$, org_t);

  execute format($t$
    create table if not exists public.comm_job_state (
      org_id     %1$s not null,
      job_id     text not null,
      crew       text[] not null default '{}',
      move_date  text,
      move_time  text,
      forms_at   timestamptz,
      version    integer not null default 1,
      updated_at timestamptz not null default now(),
      primary key (org_id, job_id)
    )$t$, org_t);
end $$;

create index if not exists comm_log_job   on public.comm_log (org_id, job_id, created_at desc);
create index if not exists comm_log_staff on public.comm_log (org_id, staff, created_at desc);
create index if not exists comm_log_to    on public.comm_log (org_id, to_number);

-- Who the signed-in person is in a company. Runs with the owner's rights so the rules
-- below never trip over the rules on the members table.
create or replace function public.comm_me(o text)
returns table (role text, staff text)
language sql stable security definer set search_path = public as $$
  select m.role::text, m.staff::text
  from public.members m
  where m.org_id::text = o and m.user_id::text = auth.uid()::text
  limit 1
$$;
revoke all on function public.comm_me(text) from public;
grant execute on function public.comm_me(text) to authenticated;

alter table public.comm_lines     enable row level security;
alter table public.comm_log       enable row level security;
alter table public.comm_job_state enable row level security;

drop policy if exists comm_lines_read on public.comm_lines;
create policy comm_lines_read on public.comm_lines for select to authenticated
  using (exists (select 1 from public.comm_me(org_id::text)));

drop policy if exists comm_log_read on public.comm_log;
create policy comm_log_read on public.comm_log for select to authenticated
  using (exists (
    select 1 from public.comm_me(org_id::text) me
    where me.role in ('owner','dispatch') or (me.staff is not null and me.staff <> '' and me.staff = comm_log.staff)
  ));
-- No insert, update or delete rules on purpose: only the Edge Function (service role) writes these.
-- comm_job_state has no rules at all, so the app cannot read or change it.

grant select on public.comm_lines, public.comm_log to authenticated;
revoke all on public.comm_job_state from anon, authenticated;
revoke all on public.comm_lines, public.comm_log from anon;
revoke insert, update, delete, truncate on public.comm_lines, public.comm_log from authenticated;
