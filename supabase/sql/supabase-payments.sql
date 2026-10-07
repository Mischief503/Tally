-- Tally: card payments through Stripe, and safe merging of saved changes.
-- Run after supabase-schema-v2.sql. Safe to run again. Nothing here removes or rewrites existing data.
--
-- doc_patch(o, p, patch)  the app saves a change to a document (a job, say) as a small patch that is
--                         merged on the server in one step, instead of "read, merge, write back".
--                         Two phones changing the same job at once no longer undo each other, and a
--                         payment the server records can't be overwritten by a phone saving a note.
--                         It runs with the caller's own rights, so the existing rules still decide
--                         who may change what.
-- pay_orgs                which companies may take card payments. YOU fill this in (Table Editor).
--                         Anyone can start a company in Tally, so this is what stops a stranger's
--                         company from charging cards into your Stripe account.
-- pay_customers           the Stripe customer for each Tally customer, so saved cards stay together.
-- pay_links               short payment links (/p/<code>) and the Stripe page each one opens.
-- pay_log                 every Stripe payment, against the job. The server counts these when it works
--                         out what is still owed, so a payment can never be taken twice by mistake.
-- pay_config              the Stripe webhook the server set up for itself, and its signing secret.
-- pay_cards               cards kept on file: which Stripe customer and card each one is. Only the
--                         server knows these; the app's saved-card list shows brand and last four.
-- pay_jobs                which Stripe customer a job belongs to, fixed by its first payment that goes
--                         through, so a changed name or phone can't point a job at someone else's card.
-- pay_locks               one payment starting per job at a time (two phones can't both charge).
-- pay_record(...)         adds, changes or removes one payment on a job document in one step.
-- jobs_guard              on every phone's save of a job: the quote stays the office's, and card
--                         payments, refunds and disputes stay as the server wrote them.
-- pay_reopen(...)         moves a Paid job back to Complete when money comes off it again (a bank
--                         payment that bounced, a refund, a dispute), with a line in its history.
--
-- Only the Edge Function (service role) touches the pay_ tables: row level security is on and they
-- have no policies, so the app can neither read nor write them directly.

-- ---------- merging a change into a document ----------
-- Same rules as the app: a key set to null is removed, objects merge key by key, anything else
-- (text, numbers, lists) replaces what was there.
create or replace function public.jsonb_merge_patch(t jsonb, p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; r jsonb;
begin
  r := case when t is not null and jsonb_typeof(t) = 'object' then t else '{}'::jsonb end;
  if p is null or jsonb_typeof(p) <> 'object' then return r; end if;
  for k, v in select key, value from jsonb_each(p) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(r -> k) = 'object' then
      r := r || jsonb_build_object(k, public.jsonb_merge_patch(r -> k, v));
    elsif jsonb_typeof(v) = 'null' then
      r := r - k;
    else
      r := r || jsonb_build_object(k, v);
    end if;
  end loop;
  return r;
end $$;

-- True when the document was there and the change was saved. Row level security applies as usual:
-- a document you may not change is simply not found.
create or replace function public.doc_patch(o uuid, p text, patch jsonb) returns boolean
language plpgsql volatile security invoker set search_path = public as $$
begin
  if patch is null or jsonb_typeof(patch) <> 'object' then raise exception 'A change must be an object'; end if;
  update public.docs set data = public.jsonb_merge_patch(data, patch), updated_at = now()
   where org_id = o and path = p;
  return found;
end $$;

-- ---------- payments ----------
create table if not exists public.pay_orgs (
  org_id      uuid primary key references public.orgs(id) on delete cascade,
  enabled     boolean not null default true,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.pay_customers (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  cust_key    text not null,
  customer_id text not null,
  livemode    boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (org_id, cust_key, livemode)
);

create table if not exists public.pay_links (
  token        text primary key check (token ~ '^[A-Za-z0-9]{8,16}$'),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  job_id       text not null,
  session_id   text not null unique,
  url          text not null,
  amount_cents integer not null check (amount_cents > 0),
  save_card    boolean not null default false,
  created_by   text not null default '',
  status       text not null default 'open' check (status in ('open','paid','expired')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists pay_links_job_idx on public.pay_links(org_id, job_id);

create table if not exists public.pay_log (
  pi           text primary key,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  job_id       text not null,
  amount_cents integer not null,
  status       text not null,
  source       text not null default '',
  method       text not null default '',
  cust_key     text not null default '',
  by_staff     text not null default '',
  livemode     boolean not null default false,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists pay_log_job_idx on public.pay_log(org_id, job_id);
create index if not exists pay_log_staff_idx on public.pay_log(by_staff, created_at);

create table if not exists public.pay_config (
  mode            text primary key check (mode in ('test','live')),
  webhook_id      text not null default '',
  webhook_secret  text not null default '',
  status          text not null default 'creating' check (status in ('creating','ready')),
  updated_at      timestamptz not null default now()
);

create table if not exists public.pay_cards (
  id           text primary key,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  cust_key     text not null,
  customer_id  text not null,
  pm_id        text not null,
  fingerprint  text not null default '',
  name         text not null default '',
  job_id       text not null default '',
  livemode     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists pay_cards_cust_idx on public.pay_cards(org_id, cust_key);

create table if not exists public.pay_jobs (
  org_id       uuid not null references public.orgs(id) on delete cascade,
  job_id       text not null,
  livemode     boolean not null default false,
  cust_key     text not null,
  customer_id  text not null,
  created_at   timestamptz not null default now(),
  primary key (org_id, job_id, livemode)
);

create table if not exists public.pay_locks (
  org_id       uuid not null references public.orgs(id) on delete cascade,
  job_id       text not null,
  until        timestamptz not null,
  primary key (org_id, job_id)
);

-- a pay link may outlive one Stripe page: cap_cents is the most it asks, session_expires when the
-- current page stops working (a fresh one is made when the link is opened again)
alter table public.pay_links add column if not exists cap_cents integer;
alter table public.pay_links add column if not exists session_expires timestamptz;
-- refunds and disputes, counted against the payment they belong to
alter table public.pay_log add column if not exists refunded_cents integer not null default 0;
alter table public.pay_log add column if not exists disputed_cents integer not null default 0;
-- the Stripe events the server's webhook listens for, so a newer version can add to them
alter table public.pay_config add column if not exists events text not null default '';
create index if not exists pay_cards_card_idx on public.pay_cards(org_id, customer_id, fingerprint);

alter table public.pay_orgs      enable row level security;
alter table public.pay_customers enable row level security;
alter table public.pay_links     enable row level security;
alter table public.pay_log       enable row level security;
alter table public.pay_config    enable row level security;
alter table public.pay_cards     enable row level security;
alter table public.pay_jobs      enable row level security;
alter table public.pay_locks     enable row level security;

-- Add, change or remove (payment = null) one payment on a job, plus one line in the job's history,
-- in one step. mark_paid moves a finished job to Paid. Runs with the caller's rights; the Edge
-- Function calls it with the service role.
create or replace function public.pay_record(o uuid, job text, pay_id text, payment jsonb,
                                             log_key text default null, log_entry jsonb default null,
                                             mark_paid boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare cur jsonb; nxt jsonb; old jsonb;
begin
  select data into cur from public.docs where org_id = o and path = 'jobs/' || job for update;
  if cur is null then return null; end if;
  old := cur -> 'payments' -> pay_id;
  -- already written exactly so (Stripe's message and the app's own check can arrive together)
  if payment is not null and jsonb_typeof(payment) <> 'null' and old is not null
     and old ->> 'amt' is not distinct from payment ->> 'amt'
     and coalesce(old ->> 'pending', '') = coalesce(payment ->> 'pending', '')
     and coalesce(old ->> 'method', '') = coalesce(payment ->> 'method', '') then
    return cur;
  end if;
  if (payment is null or jsonb_typeof(payment) = 'null') and old is null then return cur; end if;
  nxt := cur;
  if jsonb_typeof(nxt -> 'payments') is distinct from 'object' then nxt := nxt || '{"payments":{}}'::jsonb; end if;
  if payment is null or jsonb_typeof(payment) = 'null' then
    nxt := nxt #- array['payments', pay_id];
  else
    nxt := jsonb_set(nxt, array['payments', pay_id], payment, true);
  end if;
  if log_key is not null and log_entry is not null then
    if jsonb_typeof(nxt -> 'log') is distinct from 'object' then nxt := nxt || '{"log":{}}'::jsonb; end if;
    nxt := jsonb_set(nxt, array['log', log_key], log_entry, true);
  end if;
  if mark_paid and nxt ->> 'status' = 'done' then nxt := jsonb_set(nxt, '{status}', '"paid"'::jsonb); end if;
  update public.docs set data = nxt, updated_at = now() where org_id = o and path = 'jobs/' || job;
  return nxt;
end $$;

-- A Paid job goes back to Complete (status 'done'), with one line in its history. Only a job that is
-- Paid right now changes, so running it twice changes nothing more. True when it changed the job.
create or replace function public.pay_reopen(o uuid, job text, log_key text, log_entry jsonb) returns boolean
language plpgsql volatile security invoker set search_path = public as $$
declare cur jsonb;
begin
  select data into cur from public.docs where org_id = o and path = 'jobs/' || job for update;
  if cur is null or cur ->> 'status' is distinct from 'paid' then return false; end if;
  cur := jsonb_set(cur, '{status}', '"done"'::jsonb);
  if log_key is not null and log_entry is not null then
    if jsonb_typeof(cur -> 'log') is distinct from 'object' then cur := cur || '{"log":{}}'::jsonb; end if;
    cur := jsonb_set(cur, array['log', log_key], log_entry, true);
  end if;
  update public.docs set data = cur, updated_at = now() where org_id = o and path = 'jobs/' || job;
  return found;
end $$;

-- ---------- what only the office and the server change on a job ----------
-- Whatever a phone saves, three things stay as they were:
--   - the quote, unless the office saves it (a crew lead's card-on-file charges are held to the quote's
--     not-to-exceed amount, so only the office may move it);
--   - card payments, refunds and disputes (st_, rf_ and dp_ entries): only the server writes them,
--     and a phone can't remove one either;
--   - a payment of zero or less, or one with no number for its amount, is never added.
-- The change is kept as it was instead of refused, so a phone holding an old copy of a job still
-- syncs everything else. The rules on docs still decide who may change a job at all.
create or replace function public.jobs_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare k text; v jsonb; ov jsonb; pays jsonb; olds jsonb;
begin
  if auth.uid() is null then return new; end if;   -- the server (service role) and the SQL editor
  if not public.office_of(new.org_id) and (new.data -> 'quote') is distinct from (old.data -> 'quote') then
    new.data := case when old.data ? 'quote' then jsonb_set(new.data, '{quote}', old.data -> 'quote') else new.data - 'quote' end;
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

grant execute on function public.jsonb_merge_patch(jsonb, jsonb), public.doc_patch(uuid, text, jsonb) to authenticated;
grant all on public.pay_orgs, public.pay_customers, public.pay_links, public.pay_log, public.pay_config,
  public.pay_cards, public.pay_jobs, public.pay_locks to service_role;
