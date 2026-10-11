#!/usr/bin/env bash
# Membership and Tally admin: the tables are closed to the app, a company's owner can't stretch its
# own free trial or mark itself paid, a company started in the app gets the trial Tally admin set,
# and a company an admin added for someone becomes theirs only when they sign in with that email
# (confirmed). Supabase's default grants are given first, so "closed" means the same as live.
set -e
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
D=$(mktemp -d); $PGBIN/initdb -D $D -U postgres >/dev/null
$PGBIN/pg_ctl -D $D -o "-k $D -p 55436 -c listen_addresses=''" -l $D/log start >/dev/null
trap '$PGBIN/pg_ctl -D $D stop >/dev/null' EXIT
P="psql -h $D -p 55436 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database t"
$P -d t <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create publication supabase_realtime;
insert into auth.users values
 ('cccccccc-0000-0000-0000-000000000001','own@x.com', now()),
 ('cccccccc-0000-0000-0000-000000000002','New.Owner@Y.com', now()),
 ('cccccccc-0000-0000-0000-000000000003','unconfirmed@y.com', null),
 ('cccccccc-0000-0000-0000-000000000004','crew@x.com', now());
SQL
$P -d t -f supabase/sql/supabase-schema-v2.sql
$P -d t -f supabase/sql/supabase-payments.sql
$P -d t -f supabase/sql/supabase-membership.sql
$P -d t -f supabase/sql/supabase-membership.sql   # runs again cleanly
OWN=cccccccc-0000-0000-0000-000000000001; NEW=cccccccc-0000-0000-0000-000000000002; UNC=cccccccc-0000-0000-0000-000000000003
CREW=cccccccc-0000-0000-0000-000000000004
as(){ $P -d t -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tail -1; }
srv(){ $P -d t -tA -c "set role service_role; $1" 2>&1 | tail -1; }
FAILS=0
check(){ got=$(as "$1" "$3"); if [ "$got" = "$2" ]; then echo "PASS $4"; else echo "FAIL $4: got '$got' want '$2'"; FAILS=1; fi; }
same(){ if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3: got '$1' want '$2'"; FAILS=1; fi; }
says(){ got=$($P -d t -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tr '\n' ' '); case "$got" in *"$3"*) echo "PASS $4";; *) echo "FAIL $4: got '$got'"; FAILS=1;; esac; }

# ---- the plan: one row, $149 a month and 14 days free unless an admin changes it
same "$(srv "select monthly_cents||'/'||trial_days from tally_plan")" "14900/14" "the plan starts at \$149 a month with a 14-day trial"
same "$($P -d t -tA -c "select count(*) from tally_plan")" "1" "there is one plan row, even after running the file twice"

# ---- a company started in the app gets the plan's trial
O=$(as $OWN "select public.create_org('Acme Moving')")
same "$($P -d t -tA -c "select (trial_ends::date - now()::date)||' '||plan from orgs where id='$O'")" "14 trial" "a new company's free trial is 14 days"
$P -d t -c "update tally_plan set trial_days=30"
O3=$(as $CREW "select public.create_org('Crew Co')")
same "$($P -d t -tA -c "select trial_ends::date - now()::date from orgs where id='$O3'")" "30" "and follows the plan when an admin changes it"
$P -d t -c "update tally_plan set trial_days=14"

# ---- the owner can rename the company, but not stretch its trial or mark it paid
check $OWN 1 "with u as (update orgs set name='Acme Movers' where id='$O' returning 1) select count(*) from u" "the owner renames the company"
check $OWN "Acme Movers" "select name from orgs where id='$O'" "and the new name sticks"
before=$($P -d t -tA -c "select trial_ends||'|'||plan||'|'||created_at from orgs where id='$O'")
as $OWN "update orgs set trial_ends=now()+interval '10 years', plan='paid', created_at=now()+interval '1 year', created_by=null where id='$O'" >/dev/null
same "$($P -d t -tA -c "select trial_ends||'|'||plan||'|'||created_at from orgs where id='$O'")" "$before" "but the trial end, plan and start date stay as they were"
same "$($P -d t -tA -c "select created_by from orgs where id='$O'")" "$OWN" "and so does who made it"
srv "update orgs set trial_ends=now()+interval '3 days' where id='$O'" >/dev/null
same "$($P -d t -tA -c "select trial_ends::date - now()::date from orgs where id='$O'")" "3" "the server can change a trial"

# ---- every membership table is closed to the app
$P -d t -c "insert into tally_admins(user_id) values ('$OWN')"
$P -d t -c "insert into member_deals(org_id, waived) values ('$O', true)"
$P -d t -c "insert into member_subs(org_id, customer_id, subscription_id, status) values ('$O','cus_1','sub_1','active')"
$P -d t -c "insert into tally_plan_stripe(mode, kind, stripe_id) values ('test','product','prod_1')"
for t in tally_admins tally_plan tally_plan_stripe member_deals member_subs member_invites; do
  check $OWN 0 "select count(*) from $t" "an owner can't read $t"
done
says $CREW "insert into tally_admins(user_id) values ('$CREW')" "row-level security" "nobody can make themselves a Tally admin"
says $OWN "insert into member_deals(org_id, waived) values ('$O3', true)" "row-level security" "or waive a company's fee"
check $OWN "" "update member_deals set discount_pct=100 returning 1" "or give one a discount"
check $OWN "" "update tally_plan set monthly_cents=100 returning 1" "or change the price"
says $OWN "insert into member_subs(org_id, status) values ('$O3','active')" "row-level security" "or mark a company's membership as paid"
check $OWN "" "update member_subs set status='active' returning 1" "or change one"
says $OWN "insert into member_invites(org_id, email) values ('$O3','own@x.com')" "row-level security" "or add themselves to another company as owner"
got=$($P -d t -tA -c "set role anon; select count(*) from tally_admins" 2>&1 | tr '\n' ' '); case "$got" in *0*|*"permission denied"*) echo "PASS signed out: no admins to see";; *) echo "FAIL anon: $got"; FAILS=1;; esac
same "$(srv "select count(*) from tally_admins")" "1" "the server reads the admins"
same "$(srv "select waived from member_deals where org_id='$O'")" "t" "and the deals"

# ---- table rules
got=$($P -d t -tA -c "insert into member_deals(org_id, discount_pct) values ('$O3', 120)" 2>&1 | tr '\n' ' '); case "$got" in *"check"*) echo "PASS a discount over 100% is refused";; *) echo "FAIL discount 120: $got"; FAILS=1;; esac
got=$($P -d t -tA -c "insert into member_invites(org_id, email) values ('$O3', 'Someone@Y.com')" 2>&1 | tr '\n' ' '); case "$got" in *"check"*) echo "PASS invite emails are stored lower-case";; *) echo "FAIL upper-case invite: $got"; FAILS=1;; esac
got=$($P -d t -tA -c "insert into tally_plan(id) values (2)" 2>&1 | tr '\n' ' '); case "$got" in *"check"*) echo "PASS there is only ever one plan";; *) echo "FAIL second plan: $got"; FAILS=1;; esac
got=$($P -d t -tA -c "insert into tally_plan_stripe(mode, kind, stripe_id) values ('test','anything','x_123')" 2>&1 | tr '\n' ' '); case "$got" in *"check"*) echo "PASS Stripe ids are filed under known names only";; *) echo "FAIL tally_plan_stripe kind: $got"; FAILS=1;; esac

# ---- a company an admin added for someone
A=$(srv "insert into orgs(name, join_code, trial_ends) values ('Blue Moving', 'BLUE01', now() + interval '14 days') returning id")
same "$($P -d t -tA -c "select trial_ends::date - now()::date from orgs where id='$A'")" "14" "the server sets the trial of a company it adds"
srv "insert into member_invites(org_id, email, invited_by) values ('$A', 'new.owner@y.com', 'Richie'), ('$A', 'unconfirmed@y.com', 'Richie')" >/dev/null
check $CREW 0 "select public.claim_company_invites()" "someone else signing in gets nothing"
check $UNC 0 "select public.claim_company_invites()" "an email that isn't confirmed gets nothing"
check $UNC 0 "select count(*) from members where org_id='$A' and user_id='$UNC'" "and isn't added"
check $NEW 1 "select public.claim_company_invites()" "the person it was added for signs in (any capitals in the email): the company is theirs"
check $NEW owner "select role from members where org_id='$A' and user_id='$NEW'" "as its owner"
same "$($P -d t -tA -c "select claimed_by from member_invites where org_id='$A' and email='new.owner@y.com'")" "$NEW" "the invite is marked used"
check $NEW 0 "select public.claim_company_invites()" "signing in again changes nothing"
check $NEW "Blue Moving" "select name from orgs where id='$A'" "the new owner can see the company"
got=$($P -d t -tA -c "set role anon; select public.claim_company_invites()" 2>&1 | tr '\n' ' '); case "$got" in *0*|*"permission denied"*) echo "PASS signed out: nothing to claim";; *) echo "FAIL anon claim: $got"; FAILS=1;; esac

[ $FAILS -eq 0 ] && echo "membership sql: all passed" || { echo "membership sql: FAILED"; exit 1; }
