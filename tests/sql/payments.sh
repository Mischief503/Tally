#!/usr/bin/env bash
# Payments and safe merging: doc_patch keeps the existing rules, merges like the app, never loses a
# key; the pay_ tables are closed to the app; pay_record adds, changes and removes one payment.
# The database is given Supabase's default grants first, so "locked" means the same thing here
# as on the real project.
set -e
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
D=$(mktemp -d); $PGBIN/initdb -D $D -U postgres >/dev/null
$PGBIN/pg_ctl -D $D -o "-k $D -p 55435 -c listen_addresses=''" -l $D/log start >/dev/null
trap '$PGBIN/pg_ctl -D $D stop >/dev/null' EXIT
P="psql -h $D -p 55435 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database t"
$P -d t <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
-- what Supabase grants on everything new in public
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create publication supabase_realtime;
insert into auth.users values
 ('bbbbbbbb-0000-0000-0000-000000000001','own@x.com', now()),
 ('bbbbbbbb-0000-0000-0000-000000000002','lead@x.com', now()),
 ('bbbbbbbb-0000-0000-0000-000000000003','crew@x.com', now()),
 ('bbbbbbbb-0000-0000-0000-000000000004','other@x.com', now());
SQL
$P -d t -f supabase/sql/supabase-schema-v2.sql
$P -d t -f supabase/sql/supabase-payments.sql
$P -d t -f supabase/sql/supabase-payments.sql   # runs again cleanly
OWN=bbbbbbbb-0000-0000-0000-000000000001; LEAD=bbbbbbbb-0000-0000-0000-000000000002; CREW=bbbbbbbb-0000-0000-0000-000000000003
OTHER=bbbbbbbb-0000-0000-0000-000000000004
as(){ $P -d t -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tail -1; }
srv(){ $P -d t -tA -c "set role service_role; $1" 2>&1 | tail -1; }
FAILS=0
check(){ got=$(as "$1" "$3"); if [ "$got" = "$2" ]; then echo "PASS $4"; else echo "FAIL $4: got '$got' want '$2'"; FAILS=1; fi; }
same(){ if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3: got '$1' want '$2'"; FAILS=1; fi; }
says(){ got=$($P -d t -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tr '\n' ' '); case "$got" in *"$3"*) echo "PASS $4";; *) echo "FAIL $4: got '$got'"; FAILS=1;; esac; }
mp(){ $P -d t -tA -c "select public.jsonb_merge_patch('$1'::jsonb, '$2'::jsonb)::text"; }

# ---- merging works like the app's own merge
same "$(mp '{"a":{"b":1,"c":2},"x":1}' '{"a":{"b":null,"d":3}}')" '{"a": {"c": 2, "d": 3}, "x": 1}' "nested keys merge, null removes"
same "$(mp '{"x":[1,2],"y":"s"}' '{"x":[3]}')" '{"x": [3], "y": "s"}' "lists are replaced, not merged"
same "$(mp '{"a":1}' '{"a":{"b":2}}')" '{"a": {"b": 2}}' "an object replaces a plain value"
same "$(mp '{"a":{"b":1}}' '{"a":{}}')" '{"a": {"b": 1}}' "an empty object changes nothing"
same "$(mp '{"a":1}' 'null')" '{"a": 1}' "no patch: the document is unchanged"

# ---- a company with a job for the lead
O=$(as $OWN "select public.create_org('Acme Moving')")
$P -d t -c "insert into members(org_id,user_id,email,staff,role) values ('$O','$LEAD','lead@x.com','Lee','lead'),('$O','$CREW','crew@x.com','Kim','crew')"
O2=$(as $OTHER "select public.create_org('Other Co')")
$P -d t -c "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/j1','jobs','j1','{\"id\":\"j1\",\"status\":\"done\",\"assign\":{\"crew\":[\"Lee\"]},\"payments\":{\"p1\":{\"id\":\"p1\",\"amt\":100}},\"crewNotes\":{},\"log\":{}}')"

# ---- doc_patch: merges in one step, under the usual rules
check $OWN t "select public.doc_patch('$O','jobs/j1','{\"crewNotes\":{\"n1\":{\"id\":\"n1\",\"text\":\"Gate 4411\"}}}')" "the owner saves a change"
check $LEAD t "select public.doc_patch('$O','jobs/j1','{\"payments\":{\"p2\":{\"id\":\"p2\",\"amt\":50}}}')" "the lead on the job saves a change"
check $OWN "p1,p2|Gate 4411" "select (select string_agg(k,',' order by k) from jsonb_object_keys(data->'payments') k)||'|'||(data->'crewNotes'->'n1'->>'text') from docs where path='jobs/j1'" "both changes are there: neither undid the other"
check $LEAD t "select public.doc_patch('$O','jobs/j1','{\"payments\":{\"p2\":null}}')" "a key set to null"
check $OWN "p1" "select string_agg(k,',') from jsonb_object_keys((select data->'payments' from docs where path='jobs/j1')) k" "is removed"
check $CREW f "select public.doc_patch('$O','jobs/j1','{\"status\":\"paid\"}')" "crew not on the job: nothing to change"
check $OTHER f "select public.doc_patch('$O','jobs/j1','{\"status\":\"paid\"}')" "another company: nothing to change"
check $OWN done "select data->>'status' from docs where path='jobs/j1'" "and the job is untouched"
says $LEAD "select public.doc_patch('$O','jobs/j1','{\"assign\":{\"crew\":[]}}')" "row-level security" "the lead can't take himself off the job by patching it"
says $OWN "select public.doc_patch('$O','jobs/j1','[1,2]')" "must be an object" "a change that is not an object is refused"
check $OWN f "select public.doc_patch('$O','jobs/nope','{\"a\":1}')" "a missing document reports false, so the app saves it whole"
got=$($P -d t -tA -c "set role anon; select public.doc_patch('$O','jobs/j1','{\"status\":\"x\"}')" 2>&1|tr '\n' ' '); case "$got" in *"permission denied"*) echo "PASS anon can't patch";; *) echo "FAIL anon patch: $got"; FAILS=1;; esac

# ---- the pay_ tables are closed to the app
$P -d t -c "insert into pay_orgs(org_id) values ('$O')"
$P -d t -c "insert into pay_log(pi,org_id,job_id,amount_cents,status) values ('pi_1','$O','j1',5000,'succeeded')"
$P -d t -c "insert into pay_config(mode,webhook_secret,status) values ('test','whsec_x','ready')"
check $OWN 0 "select count(*) from pay_orgs" "the owner can't read which companies take cards"
check $OWN 0 "select count(*) from pay_log" "or the payment log"
check $OWN 0 "select count(*) from pay_config" "or the webhook secret"
says $OWN "insert into pay_orgs(org_id) values ('$O2')" "row-level security" "a company can't turn itself on for payments"
says $OTHER "insert into pay_log(pi,org_id,job_id,amount_cents,status) values ('pi_x','$O','j1',1,'succeeded')" "row-level security" "nobody can fake a payment in the log"
check $OWN "" "update pay_config set webhook_secret='mine' returning 1" "or change the webhook secret"
same "$(srv "select count(*) from pay_log")" "1" "the server (service role) reads the log"

# ---- pay_record: one payment, one history line, in one step
srv "select public.pay_record('$O','j1','st_pi_9','{\"id\":\"st_pi_9\",\"amt\":75,\"method\":\"Visa 4242\"}','lx_1','{\"ts\":1,\"ev\":\"Payment\"}', true)" >/dev/null
check $OWN "75|Visa 4242|Payment|paid" "select (data->'payments'->'st_pi_9'->>'amt')||'|'||(data->'payments'->'st_pi_9'->>'method')||'|'||(data->'log'->'lx_1'->>'ev')||'|'||(data->>'status') from docs where path='jobs/j1'" "payment and history line saved, finished job marked paid"
check $OWN "p1,st_pi_9" "select string_agg(k,',' order by k) from jsonb_object_keys((select data->'payments' from docs where path='jobs/j1')) k" "the other payments are kept"
srv "select public.pay_record('$O','j1','st_pi_9',null,'lx_2','{\"ts\":2,\"ev\":\"Bank payment failed\"}', false)" >/dev/null
check $OWN "p1|Bank payment failed" "select (select string_agg(k,',') from jsonb_object_keys(data->'payments') k)||'|'||(data->'log'->'lx_2'->>'ev') from docs where path='jobs/j1'" "a failed bank payment is taken off again"
$P -d t -c "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/j2','jobs','j2','{\"id\":\"j2\",\"status\":\"booked\",\"assign\":{\"crew\":[]}}')"
srv "select public.pay_record('$O','j2','st_pi_8','{\"id\":\"st_pi_8\",\"amt\":20}',null,null,true)" >/dev/null
check $OWN "20|booked" "select (data->'payments'->'st_pi_8'->>'amt')||'|'||(data->>'status') from docs where path='jobs/j2'" "a deposit on a booked job: payments map created, status stays booked"
same "$(srv "select coalesce(public.pay_record('$O','nope','x','{\"amt\":1}')::text,'none')")" "none" "a job that isn't there: nothing happens"
check $CREW "" "select coalesce(public.pay_record('$O','j1','st_x','{\"amt\":1}')::text,'')" "crew calling it directly gets nothing: it runs with their own rights"
check $OWN "p1" "select string_agg(k,',') from jsonb_object_keys((select data->'payments' from docs where path='jobs/j1')) k" "and nothing was added"

# ---- the same payment arriving twice (Stripe's message and the app's check) writes one history line
$P -d t -c "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/j3','jobs','j3','{\"id\":\"j3\",\"status\":\"done\",\"assign\":{\"crew\":[]},\"payments\":{},\"log\":{}}')"
srv "select public.pay_record('$O','j3','st_pi_7','{\"id\":\"st_pi_7\",\"amt\":40,\"method\":\"Visa\"}','la','{\"ts\":1,\"ev\":\"Payment\"}', false)" >/dev/null
srv "select public.pay_record('$O','j3','st_pi_7','{\"id\":\"st_pi_7\",\"amt\":40,\"method\":\"Visa\"}','lb','{\"ts\":2,\"ev\":\"Payment\"}', false)" >/dev/null
same "$(srv "select count(*) from jsonb_object_keys((select data->'log' from docs where path='jobs/j3'))")" "1" "the same payment twice: one history line"
srv "select public.pay_record('$O','j3','st_pi_7','{\"id\":\"st_pi_7\",\"amt\":40,\"method\":\"Visa\",\"pending\":true}','lc','{\"ts\":3,\"ev\":\"Pending\"}', false)" >/dev/null
same "$(srv "select count(*) from jsonb_object_keys((select data->'log' from docs where path='jobs/j3'))")" "2" "a real change still writes its line"
srv "select public.pay_record('$O','j3','st_nothing',null,'ld','{\"ts\":4,\"ev\":\"Removed\"}', false)" >/dev/null
same "$(srv "select count(*) from jsonb_object_keys((select data->'log' from docs where path='jobs/j3'))")" "2" "removing a payment that isn't there writes nothing"

# ---- pay_reopen: a Paid job goes back to Complete when money comes off it
$P -d t -c "update docs set data = jsonb_set(data,'{status}','\"paid\"') where path='jobs/j3'"
same "$(srv "select public.pay_reopen('$O','j3','lr','{\"ts\":5,\"ev\":\"Back to Complete\"}')")" "t" "a Paid job is reopened"
same "$(srv "select (data->>'status')||'|'||(data->'log'->'lr'->>'ev') from docs where path='jobs/j3'")" "done|Back to Complete" "it is Complete again, and the history says why"
same "$(srv "select public.pay_reopen('$O','j3','lr2','{\"ts\":6,\"ev\":\"Again\"}')")" "f" "running it again changes nothing"
same "$(srv "select (data->'log'->'lr2') is null from docs where path='jobs/j3'")" "t" "and writes no second line"
same "$(srv "select public.pay_reopen('$O','j2','lx','{\"ts\":7,\"ev\":\"x\"}')")" "f" "a job that isn't Paid is left alone"
$P -d t -c "update docs set data = jsonb_set(data,'{status}','\"paid\"') where path='jobs/j3'"
check $CREW f "select public.pay_reopen('$O','j3','ly','{\"ts\":8,\"ev\":\"x\"}')" "crew calling it directly changes nothing: their own rights apply"
same "$(srv "select data->>'status' from docs where path='jobs/j3'")" "paid" "the job is still Paid"

# ---- the newer pay_ tables are closed to the app too
$P -d t -c "insert into pay_cards(id,org_id,cust_key,customer_id,pm_id) values ('st_pm_1','$O','5125550142','cus_1','pm_1')"
$P -d t -c "insert into pay_jobs(org_id,job_id,cust_key,customer_id) values ('$O','j1','5125550142','cus_1')"
$P -d t -c "insert into pay_locks(org_id,job_id,until) values ('$O','j1',now())"
check $OWN 0 "select count(*) from pay_cards" "the app can't read the Stripe ids of cards on file"
check $OWN 0 "select count(*) from pay_jobs" "or which Stripe customer a job belongs to"
says $LEAD "insert into pay_cards(id,org_id,cust_key,customer_id,pm_id) values ('st_pm_x','$O','5125559999','cus_9','pm_9')" "row-level security" "nobody can slip a card onto the list"
says $OWN "insert into pay_jobs(org_id,job_id,cust_key,customer_id,livemode) values ('$O','j2','x','cus_9',true)" "row-level security" "or point a job at another customer"
check $OWN "" "delete from pay_locks returning 1" "or clear a payment lock"
same "$(srv "select refunded_cents||','||disputed_cents from pay_log where pi='pi_1'")" "0,0" "older ledger rows read as no refunds and no disputes"
same "$(srv "select events from pay_config where mode='test'")" "" "the webhook's event list starts empty, so the server brings it up to date"

# ---- what only the office and the server change on a job (jobs_guard)
$P -d t -c "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/j4','jobs','j4','{\"id\":\"j4\",\"status\":\"done\",\"assign\":{\"crew\":[\"Lee\"]},\"quote\":{\"total\":1200,\"nte\":1380},\"payments\":{\"p1\":{\"id\":\"p1\",\"amt\":100}},\"log\":{}}')"
srv "select public.pay_record('$O','j4','st_pi_5','{\"id\":\"st_pi_5\",\"amt\":200,\"method\":\"Visa\",\"stripe\":\"pi_5\"}', null, null, false)" >/dev/null
q4(){ echo "select $1 from docs where path='jobs/j4'"; }
check $LEAD t "select public.doc_patch('$O','jobs/j4','{\"quote\":{\"total\":9000,\"nte\":9999}}')" "a lead's change to the quote saves without an error"
check $OWN "1200|1380" "$(q4 "(data->'quote'->>'total')||'|'||(data->'quote'->>'nte')")" "but the quote stays as the office set it"
check $OWN t "select public.doc_patch('$O','jobs/j4','{\"quote\":{\"total\":1300}}')" "the office changes the quote"
check $OWN "1300|1380" "$(q4 "(data->'quote'->>'total')||'|'||(data->'quote'->>'nte')")" "and it sticks"
check $LEAD "" "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/j4','jobs','j4',(select jsonb_set(data,'{quote,total}','5000') from docs where path='jobs/j4')) on conflict (org_id,path) do update set data=excluded.data returning null" "a lead saving the whole job over it (the app's upsert)"
check $OWN "1300" "$(q4 "data->'quote'->>'total'")" "still leaves the quote alone"
check $LEAD t "select public.doc_patch('$O','jobs/j4','{\"payments\":{\"st_pi_fake\":{\"id\":\"st_pi_fake\",\"amt\":500,\"stripe\":\"pi_fake\"},\"p9\":{\"id\":\"p9\",\"amt\":-300},\"p8\":{\"id\":\"p8\",\"amt\":\"40\"},\"p7\":{\"id\":\"p7\",\"amt\":25,\"stripe\":\"pi_x\"},\"p6\":{\"id\":\"p6\",\"amt\":60}}}')" "a lead saves a batch of payments"
check $OWN "p1,p6,st_pi_5" "$(q4 "(select string_agg(k,',' order by k) from jsonb_object_keys(data->'payments') k)")" "only the real cash payment is added: no card payment, nothing negative, nothing that isn't a number"
check $LEAD t "select public.doc_patch('$O','jobs/j4','{\"payments\":{\"st_pi_5\":{\"id\":\"st_pi_5\",\"amt\":2000,\"method\":\"Visa\",\"stripe\":\"pi_5\"}}}')" "a lead changes a card payment"
check $OWN "200" "$(q4 "data->'payments'->'st_pi_5'->>'amt'")" "it stays as the server wrote it"
check $LEAD t "select public.doc_patch('$O','jobs/j4','{\"payments\":{\"st_pi_5\":null,\"p6\":null}}')" "a lead removes a card payment and a cash one"
check $OWN "p1,st_pi_5" "$(q4 "(select string_agg(k,',' order by k) from jsonb_object_keys(data->'payments') k)")" "the cash one goes, the card payment stays"
check $OWN t "select public.doc_patch('$O','jobs/j4','{\"payments\":{\"rf_pi_5\":{\"id\":\"rf_pi_5\",\"amt\":-200,\"stripe\":\"pi_5\"}}}')" "the office tries to add a refund line itself"
check $OWN "" "$(q4 "coalesce(data->'payments'->>'rf_pi_5','')")" "only the server writes refunds"
check $OWN t "select public.doc_patch('$O','jobs/j4','{\"payments\":null}')" "a change that drops the payments list"
check $OWN "st_pi_5" "$(q4 "(select string_agg(k,',' order by k) from jsonb_object_keys(data->'payments') k)")" "keeps the card payment"
srv "select public.pay_record('$O','j4','rf_pi_5','{\"id\":\"rf_pi_5\",\"amt\":-50,\"method\":\"Refund\",\"stripe\":\"pi_5\"}', null, null, false)" >/dev/null
same "$(srv "select data->'payments'->'rf_pi_5'->>'amt' from docs where path='jobs/j4'")" "-50" "the server still writes refunds"

echo
[ $FAILS -eq 0 ] && echo "payments sql: all passed" || { echo "payments sql: FAILURES"; exit 1; }
