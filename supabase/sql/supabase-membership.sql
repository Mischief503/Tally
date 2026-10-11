-- Tally membership and Tally admin
--
-- What each company pays Tally's owner every month, and the people who run Tally.
-- Run after supabase-schema-v2.sql and supabase-payments.sql. Safe to run again: it only adds.
--
-- tally_admins        who runs Tally. Only added here (the SQL editor or a migration):
--                     nobody can make themselves an admin from the app. To add yourself:
--                       insert into public.tally_admins(user_id)
--                         select id from auth.users where lower(email) = 'you@example.com';
-- tally_plan          the membership: monthly price and free trial for new companies (one row).
-- tally_plan_stripe   what the server made in Stripe for it, per mode: the product, a price per
--                     amount, a coupon per discount, the billing page settings.
-- member_deals        per company, set by an admin only: a test company (never pays), the fee
--                     waived, a discount in percent, a note.
-- member_subs         per company and mode: its Stripe customer and subscription, as Stripe last said,
--                     and the membership checkout page that is open, if any.
-- member_invites      a company an admin added for someone: the owner's email. The person becomes the
--                     owner when they sign in with that email (confirmed): claim_company_invites().
-- orgs_guard          app users can't change a company's plan, trial end, or when and by whom it
--                     was made (the owner may still rename it).
-- orgs_trial          a company started in the app gets the free trial tally_plan says.
--
-- Only the Edge Function (service role) reads or writes the tables: row level security is on and
-- they have no policies.

create table if not exists public.tally_admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now()
);

create table if not exists public.tally_plan (
  id             int primary key default 1 check (id = 1),
  monthly_cents  int not null default 14900 check (monthly_cents between 100 and 10000000),
  trial_days     int not null default 14 check (trial_days between 0 and 365),
  updated_by     text not null default '',
  updated_at     timestamptz not null default now()
);
insert into public.tally_plan(id) values (1) on conflict (id) do nothing;

create table if not exists public.tally_plan_stripe (
  mode        text not null check (mode in ('test','live')),
  kind        text not null check (kind ~ '^(product|portal|price:[0-9]{3,8}|coupon:[0-9]{1,3})$'),
  stripe_id   text not null check (length(stripe_id) between 3 and 255),
  updated_at  timestamptz not null default now(),
  primary key (mode, kind)
);

create table if not exists public.member_deals (
  org_id        uuid primary key references public.orgs(id) on delete cascade,
  is_test       boolean not null default false,
  waived        boolean not null default false,
  discount_pct  int not null default 0 check (discount_pct between 0 and 100),
  note          text not null default '' check (length(note) <= 500),
  updated_by    text not null default '',
  updated_at    timestamptz not null default now()
);

create table if not exists public.member_subs (
  org_id                uuid not null references public.orgs(id) on delete cascade,
  livemode              boolean not null default false,
  customer_id           text not null default '',
  subscription_id       text not null default '',
  status                text not null default '',
  price_id              text not null default '',
  current_period_end    timestamptz,
  cancel_at_period_end  boolean not null default false,
  trial_end             timestamptz,
  checkout_id           text not null default '',
  checkout_url          text not null default '',
  checkout_expires      timestamptz,
  updated_at            timestamptz not null default now(),
  primary key (org_id, livemode)
);
create index if not exists member_subs_customer_idx on public.member_subs(customer_id);

create table if not exists public.member_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  email       text not null check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role        text not null default 'owner' check (role = 'owner'),
  invited_by  text not null default '',
  claimed_by  uuid references auth.users(id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);

alter table public.tally_admins      enable row level security;
alter table public.tally_plan        enable row level security;
alter table public.tally_plan_stripe enable row level security;
alter table public.member_deals      enable row level security;
alter table public.member_subs       enable row level security;
alter table public.member_invites    enable row level security;
grant all on public.tally_admins, public.tally_plan, public.tally_plan_stripe, public.member_deals,
  public.member_subs, public.member_invites to service_role;

-- A company's plan, trial and origin are the server's to change. The owner of a company can still
-- update its row (to rename it), so without this they could stretch their own free trial.
create or replace function public.orgs_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- the server (service role) and the SQL editor
  new.plan := old.plan;
  new.trial_ends := old.trial_ends;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end $$;
create or replace trigger orgs_guard before update on public.orgs
  for each row execute function public.orgs_guard();

-- A company started in the app (create_org) gets the free trial set in Tally admin. The server sets
-- its own companies' trial itself.
create or replace function public.orgs_trial() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int;
begin
  if auth.uid() is null then return new; end if;
  select trial_days into d from public.tally_plan where id = 1;
  new.trial_ends := now() + make_interval(days => coalesce(d, 14));
  new.plan := 'trial';
  return new;
end $$;
create or replace trigger orgs_trial before insert on public.orgs
  for each row execute function public.orgs_trial();

-- Right after sign-in: the companies an admin added for this person's email (confirmed only) become
-- theirs, as owner. Returns how many.
create or replace function public.claim_company_invites() returns int
language plpgsql volatile security definer set search_path = public as $$
declare em text; ok boolean; n int := 0; r record;
begin
  if auth.uid() is null then return 0; end if;
  select lower(email), email_confirmed_at is not null into em, ok from auth.users where id = auth.uid();
  if em is null or em = '' or not coalesce(ok, false) then return 0; end if;
  for r in select * from public.member_invites where email = em and claimed_at is null for update loop
    insert into public.members(org_id, user_id, email, staff, role)
      values (r.org_id, auth.uid(), em, '', 'owner')
      on conflict (org_id, user_id) do update set role = 'owner';
    update public.member_invites set claimed_by = auth.uid(), claimed_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.claim_company_invites() to authenticated;
