#!/usr/bin/env bash
# The call center service (Oct 22): Tally's own team (tally_cc_team, linked at sign-in by claim_cc_team),
# working for the companies that have the service (cc_orgs). For those companies only, what they read (the
# rate card copy, the open quotes and leads, and the schedule as a copy without the money) and write (open
# quotes through cc_save: changing one, booking it, marking it lost; no discount of its own, no payments),
# the copies the triggers keep, and supabase-callcenter.sql bringing a database set up before the call
# center to exactly the rules today's files make.
set -e
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
D=$(mktemp -d); $PGBIN/initdb -D $D -U postgres >/dev/null
$PGBIN/pg_ctl -D $D -o "-k $D -p 55436 -c listen_addresses=''" -l $D/log start >/dev/null
trap '$PGBIN/pg_ctl -D $D stop >/dev/null' EXIT
P="psql -h $D -p 55436 -U postgres -v ON_ERROR_STOP=1 -q"
FAILS=0
python3 scripts/cc_sql.py --check && echo "PASS supabase-callcenter.sql is the base files' call center blocks" || { echo "FAIL supabase-callcenter.sql is out of date"; FAILS=1; }
$P -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;"
setup(){
$P -c "create database $1"
$P -d $1 <<'SQL'
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create publication supabase_realtime;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
insert into auth.users values
 ('cccccccc-0000-0000-0000-000000000001','own@x.com', now()),('cccccccc-0000-0000-0000-000000000002','dis@x.com', now()),
 ('cccccccc-0000-0000-0000-000000000003','jess@x.com', now()),('cccccccc-0000-0000-0000-000000000004','marcus@x.com', now()),
 ('cccccccc-0000-0000-0000-000000000005','other@x.com', now()),('cccccccc-0000-0000-0000-000000000006','zoe@x.com', now()),
 ('cccccccc-0000-0000-0000-000000000007','kim@x.com', null),('cccccccc-0000-0000-0000-000000000008','riley@x.com', now());
SQL
$P -d $1 -f supabase/sql/supabase-schema-v2.sql
$P -d $1 -f supabase/sql/supabase-employees.sql
$P -d $1 -f supabase/sql/supabase-payments.sql
}
OWN=cccccccc-0000-0000-0000-000000000001; DIS=cccccccc-0000-0000-0000-000000000002; JESS=cccccccc-0000-0000-0000-000000000003
MARCUS=cccccccc-0000-0000-0000-000000000004; OTHER=cccccccc-0000-0000-0000-000000000005; ZOE=cccccccc-0000-0000-0000-000000000006
KIM=cccccccc-0000-0000-0000-000000000007; RILEY=cccccccc-0000-0000-0000-000000000008
DB=t
as(){ $P -d $DB -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tail -1; }
pg(){ $P -d $DB -tA -c "$1" 2>&1 | tail -1; }
check(){ got=$(as "$1" "$3"); if [ "$got" = "$2" ]; then echo "PASS $4"; else echo "FAIL $4: got '$got' want '$2'"; FAILS=1; fi; }
says(){ got=$($P -d $DB -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tr '\n' ' '); case "$got" in *"$3"*) echo "PASS $4";; *) echo "FAIL $4: got '$got'"; FAILS=1;; esac; }
denied(){ got=$(as "$1" "$2"); case "$got" in *ERROR*|0|"") echo "PASS $3";; *) echo "FAIL $3: got '$got'"; FAILS=1;; esac; }
same(){ if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3: got '$1' want '$2'"; FAILS=1; fi; }
# every definition the call center touches, to compare two databases
defs(){ $P -d $1 -tA -c "select string_agg(x, E'\n' order by x) from (
  select 'policy '||polrelid::regclass||' '||polname||' '||coalesce(pg_get_expr(polqual, polrelid),'')||' / '||coalesce(pg_get_expr(polwithcheck, polrelid),'') x
    from pg_policy where polrelid in ('public.docs'::regclass,'public.orgs'::regclass)
  union all select 'fn '||p.proname||' '||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('can_write_doc','cc_agent','cc_member','cc_in','cc_open','cc_clean','cc_save','claim_cc_team','cc_me','my_orgs','sched_of','sched_sync','ratecard_of','ratecard_sync','jobs_guard')
  union all select 'con '||conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint
    where conrelid in ('public.members'::regclass,'public.docs'::regclass,'public.employees'::regclass,'public.tally_cc_team'::regclass,'public.cc_orgs'::regclass)
  union all select 'col '||table_name||' '||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'') from information_schema.columns
    where table_schema='public' and table_name in ('tally_cc_team','cc_orgs')
  union all select 'idx '||indexname||' '||indexdef from pg_indexes where schemaname='public' and tablename in ('tally_cc_team','cc_orgs')
  union all select 'tbl '||relname||' rls='||relrowsecurity||' '||coalesce(relacl::text,'') from pg_class where oid in ('public.tally_cc_team'::regclass,'public.cc_orgs'::regclass)
  union all select 'trg '||tgname||' '||pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.docs'::regclass and not tgisinternal
  union all select 'acl '||p.proname||' '||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('cc_agent','cc_member','cc_in','cc_open','cc_clean','cc_save','claim_cc_team','cc_me','my_orgs','sched_of','sched_sync','ratecard_of','ratecard_sync')) s"; }
job(){ echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/$1','jobs','$1','$2') on conflict (org_id,path) do update set data=excluded.data returning 1"; }
doc(){ echo "insert into docs(org_id,path,collection,doc_id,data) values ('$1','$2','${2%%/*}','${2#*/}','$3') on conflict (org_id,path) do update set data=excluded.data returning 1"; }
SETTINGS='{"company":"Acme Moving","rates":{"r2":140,"r3":195,"r4":250},"minHours":3,"truckFee":45,"includedMiles":20,"mileRate":1.5,"shopAddress":"1200 Industrial Blvd, Austin, TX","shopGeo":{"lat":30.33,"lon":-97.7,"addr":"1200 Industrial Blvd, Austin, TX"},"trucks":[{"id":"t26","name":"Box 1 (26 ft)","cf":1700}],"opt":{"tax":false},"crew":["Marcus","Dee"],"contacts":{"Owner":"512-555-0100","Marcus":"512-555-0101"},"crewCost":24,"perms":{},"materials":[{"id":"m1","name":"Box","price":4,"cost":1.5}],"office":[{"name":"Owner","kind":"owner"}]}'

# ---------- a fresh install, with supabase-callcenter.sql run on top (twice) ----------
setup t
$P -d t -f supabase/sql/supabase-callcenter.sql
$P -d t -f supabase/sql/supabase-callcenter.sql && echo "PASS supabase-callcenter.sql runs again cleanly"
O=$(as $OWN "select public.create_org('Acme Moving')"); O2=$(as $OTHER "select public.create_org('Other Co')")
for p in "$DIS:Dispatch:dispatch" "$MARCUS:Marcus:crew" "$RILEY:Riley:crew"; do IFS=: read U N R <<<"$p"
  as $OWN "insert into members(org_id,user_id,email,staff,role,ts) values ('$O','$U','x','$N','$R',1)" >/dev/null; done
says $OWN "insert into members(org_id,user_id,email,staff,role,ts) values ('$O','$JESS','x','Jess','callcenter',1) returning 1" "members_role_check" "a member's role is never the call center (Tally's team is no member; a company's own call center people are crew or leads named in the settings' ccStaff)"
says $OWN "insert into employees(org_id,name,role,email) values ('$O','Riley','callcenter','riley@x.com') returning 1" "employees_role_check" "nor an employee profile"
# Tally admin (the Edge Function, as the service role) adds the team and switches the service on
pg "insert into tally_cc_team(email,name,added_by) values ('jess@x.com','Jess','richie'),('zoe@x.com','Zoe','richie'),('kim@x.com','Kim','richie'),('marcus@x.com','Marcus','richie')" >/dev/null
denied $JESS "select count(*) from tally_cc_team" "nobody in the app reads the team list"
denied $JESS "insert into tally_cc_team(email,name) values ('me@x.com','Me') returning 1" "or adds to it"
denied $OWN "insert into cc_orgs(org_id) values ('$O') returning 1" "and an owner can't switch the service on (Tally admin does)"
check $JESS "" "select string_agg(name, ',') from my_orgs()" "before Jess signs in, she has no companies"
check $JESS "true" "select public.claim_cc_team()::text" "signing in links her to the team"
check $JESS "Jess" "select public.cc_me()" "under her name"
check $KIM "false|" "select public.claim_cc_team()||'|'||coalesce(public.cc_me(),'')" "someone whose email isn't confirmed yet isn't linked"
as $ZOE "select public.claim_cc_team()" >/dev/null; as $MARCUS "select public.claim_cc_team()" >/dev/null
check $JESS "" "select string_agg(name, ',') from my_orgs()" "with no company switched on, the team has none"
pg "insert into cc_orgs(org_id,on_by) values ('$O','richie')" >/dev/null
check $JESS "Acme Moving|callcenter||false" "select name||'|'||role||'|'||coalesce(join_code,'')||'|'||pending from my_orgs()" "Acme switched on: the team's company list has it, as the call center, without its company code"
check $OTHER "Other Co|owner" "select string_agg(name||'|'||role, ',') from my_orgs()" "a company without the service sees no change"
check $MARCUS "Acme Moving|crew" "select string_agg(name||'|'||role, ',') from my_orgs()" "a company's own crew on the team is still just crew there"
check $JESS "Acme Moving" "select string_agg(name, ',') from orgs" "the team reads the company's name, and no other company's"
# the office's jobs and settings: open ones, scheduled ones, and ones done with
BOOK='{"id":"b1","status":"booked","d":{"name":"Priya Nair","phone":"512-555-0142","moveDate":"2026-10-30","time":"08:00","from":"418 Oak St","to":"77 Ridge Rd","notes":"Gate 4411","discount":"25"},"quote":{"total":900,"rate":140,"crew":3,"hours":4,"lines":[{"label":"3 movers","amt":780}],"nte":1035,"deposit":225,"truckId":"t26","truckName":"Box 1 (26 ft)","nTrucks":1},"items":[{"id":"sofa3","name":"Sofa (3-seat)","cf":55,"qty":1}],"assign":{"truckId":"t26","crew":["Marcus","Dee"]},"payments":{"p1":{"id":"p1","amt":225,"method":"Card"}},"extras":{"x":{"id":"x","label":"Parking","amt":20}}}'
for j in "q1:{\"id\":\"q1\",\"status\":\"quoted\",\"d\":{\"name\":\"Ortega\",\"discount\":\"50\"},\"quote\":{\"total\":465},\"payments\":{}}" \
         "l1:{\"id\":\"l1\",\"status\":\"lead\",\"d\":{\"name\":\"Sam\"},\"payments\":{}}" "b1:$BOOK" \
         "a1:{\"id\":\"a1\",\"status\":\"active\",\"d\":{\"name\":\"Nadia\",\"moveDate\":\"2026-10-22\"},\"quote\":{\"total\":515},\"assign\":{\"truckId\":\"t16\",\"crew\":[\"Marcus\"]}}" \
         "d1:{\"id\":\"d1\",\"status\":\"done\",\"d\":{\"name\":\"Hollis\"},\"quote\":{\"total\":700}}" "x1:{\"id\":\"x1\",\"status\":\"lost\",\"d\":{\"name\":\"Gone\"}}"; do
  id=${j%%:*}; as $DIS "$(job $id "${j#*:}")" >/dev/null; done
as $OWN "$(doc $O org/settings "$SETTINGS")" >/dev/null
for d in 'meta/init:{"ts":1}' 'chat/m1:{"id":"m1","from":"Dispatch","text":"Gate code is 4411"}' 'locs/marcus:{"name":"Marcus","lat":30.27,"lng":-97.74}' \
         'photos/ph1:{"id":"ph1","jobId":"q1","data":"data:image/jpeg;base64,xx"}' 'formpages/fp1:{"id":"fp1","data":"data:image/png;base64,xx"}'; do
  as $OWN "$(doc $O ${d%%:*} "${d#*:}")" >/dev/null; done
as $OTHER "$(doc $O2 jobs/o1 '{"id":"o1","status":"quoted","d":{"name":"Not yours"}}')" >/dev/null
as $OTHER "$(doc $O2 org/settings '{"company":"Other Co","rates":{"r2":99}}')" >/dev/null
check $OWN 6 "select count(*) from docs where collection='jobs'" "the office has its 6 jobs"

# reading
check $JESS "l1,q1" "select string_agg(doc_id, ',' order by doc_id) from docs where collection='jobs'" "the call center reads the open quotes and leads, nothing else of the jobs"
check $JESS "a1,b1" "select string_agg(doc_id, ',' order by doc_id) from docs where collection='sched'" "and the schedule: the booked and in-progress jobs, as copies"
check $JESS "0" "select count(*) from docs where collection='sched' and (data ? 'payments' or data ? 'extras' or data->'quote' ? 'total' or data->'quote' ? 'rate' or data->'quote' ? 'lines' or data->'quote' ? 'deposit' or data->'quote' ? 'nte' or data->'d' ? 'discount')" "the copies have no money in them: no price, rate, lines, deposit, payments, charges or discount"
check $JESS "Priya Nair|512-555-0142|2026-10-30|08:00|418 Oak St|77 Ridge Rd|Gate 4411|Sofa (3-seat)|1|3|4|Box 1 (26 ft)|2|false" "select concat_ws('|', data->'d'->>'name', data->'d'->>'phone', data->'d'->>'moveDate', data->'d'->>'time', data->'d'->>'from', data->'d'->>'to', data->'d'->>'notes', data->'items'->0->>'name', data->'items'->0->>'qty', data->'quote'->>'crew', data->'quote'->>'hours', data->'quote'->>'truckName', data->'assign'->>'crewN', (data->'assign' ? 'crew')::text) from docs where path='sched/b1'" "what a copy has: the customer, day and time, addresses, notes, items, crew size, hours, truck, how many on the crew (not who)"
check $JESS "Acme Moving|140|3|45|30.33|Box 1 (26 ft)|false|false|false|false|false|false" "select concat_ws('|', data->>'company', data->'rates'->>'r2', data->>'minHours', data->>'truckFee', data->'shopGeo'->>'lat', data->'trucks'->0->>'name', (data ? 'crew')::text, (data ? 'contacts')::text, (data ? 'crewCost')::text, (data ? 'perms')::text, (data ? 'materials')::text, (data ? 'office')::text) from docs where path='ratecard/main'" "the rate card: the prices, the shop's spot and the trucks; not the crew, phones, crew cost, permissions, material costs or the office"
check $JESS "meta,ratecard,sched" "select string_agg(distinct collection, ',' order by collection) from docs where collection <> 'jobs'" "besides the open quotes, the rate card, the schedule copies and the company's start mark: not the settings, the chat, the crew's locations, the photos or the forms"
check $JESS "0|0" "select (select count(*) from members)||'|'||(select count(*) from access_requests)" "nor the company's people"
check $MARCUS "chat,formpages,locs,meta,org,photos" "select string_agg(distinct collection, ',' order by collection) from docs where collection not in ('jobs','shifts','vault')" "the crew reads what it did before, and not the rate card or the copies"
check $MARCUS "a1,b1" "select string_agg(doc_id, ',' order by doc_id) from docs where collection='jobs'" "and a crew member on the team is crew in his own company: his jobs, not the open quotes"
check $ZOE "l1,q1" "select string_agg(doc_id, ',' order by doc_id) from docs where collection='jobs'" "everyone on the team works for Acme"
check $JESS 0 "select count(*) from docs where org_id='$O2'" "a company without the service: nothing"
check $KIM 0 "select count(*) from docs" "and someone not linked to the team reads nothing"
check $OWN "1|1" "select (select count(*) from docs where path='ratecard/main')||'|'||(select count(*) from docs where collection='sched' and doc_id='b1')" "the office reads the copies too"

# a company's own call center person (Oct 28: Setup › Employees › Call center puts their name in the settings' ccStaff)
check $RILEY "|0|false" "select coalesce(string_agg(doc_id, ','),'')||'|'||(select count(*) from docs where collection='sched')||'|'||public.cc_member('$O')::text from docs where collection='jobs'" "Riley, crew on no job, reads no jobs and no schedule copies"
as $OWN "update docs set data=jsonb_set(data,'{ccStaff}','[\"Riley\",\"Dispatch\"]') where path='org/settings'" >/dev/null
check $RILEY "l1,q1|a1,b1|1|true" "select string_agg(doc_id, ',' order by doc_id)||'|'||(select string_agg(doc_id, ',' order by doc_id) from docs where collection='sched')||'|'||(select count(*) from docs where path='ratecard/main')||'|'||public.cc_member('$O')::text from docs where collection='jobs'" "the owner switches Riley to the call center: the open quotes, the schedule's copies and the rate card, and not the booked jobs themselves"
check $DIS "false" "select public.cc_member('$O')::text" "dispatch named there too is still the office (it books anyway)"
check $RILEY ok "select public.cc_save('$O','jobs/r1','{\"id\":\"r1\",\"status\":\"booked\",\"d\":{\"name\":\"In House\",\"moveDate\":\"2026-11-03\",\"time\":\"09:00\",\"slots\":[\"t26\"]},\"quote\":{\"total\":515,\"crew\":2,\"hours\":3},\"payments\":{}}',null)" "Riley books a move through cc_save"
check $RILEY "1|t26" "select count(*)||'|'||(select data->'d'->'slots'->>0 from docs where path='sched/r1') from docs where path='sched/r1'" "and it's on the schedule's copy, in its slot"
says $RILEY "select public.cc_save('$O','jobs/q1',null,'{\"d\":{\"discount\":\"0\"}}')" "Only the office gives a discount" "no discount of her own"
denied $RILEY "update docs set data=jsonb_set(data,'{ccStaff}','[\"Riley\",\"Marcus\"]') where path='org/settings' returning 1" "and she can't add anyone (the settings are the owner's)"
as $OWN "update docs set data=jsonb_set(data,'{ccStaff}','[]') where path='org/settings'" >/dev/null
check $RILEY "|false" "select coalesce(string_agg(doc_id, ','),'')||'|'||public.cc_member('$O')::text from docs where collection='jobs'" "switched off: she reads no open quotes again"
says $RILEY "select public.cc_save('$O','jobs/r2','{\"id\":\"r2\",\"status\":\"quoted\",\"d\":{\"name\":\"Late\"},\"payments\":{}}',null)" "Only the call center saves jobs this way" "and can't save one"
as $DIS "delete from docs where path='jobs/r1'" >/dev/null

# writing: only through cc_save, which checks what the call center saves
cc(){ echo "select public.cc_save('$O','jobs/$1',$2,$3)"; }
check $JESS ok "$(cc n1 "'{\"id\":\"n1\",\"status\":\"quoted\",\"d\":{\"name\":\"New One\",\"discount\":\"\"},\"quote\":{\"total\":420},\"payments\":{},\"createdBy\":\"Jess\",\"createdCC\":true}'" null)" "the call center makes a quote"
check $JESS ok "$(cc n2 "'{\"id\":\"n2\",\"status\":\"booked\",\"d\":{\"name\":\"Booked Now\",\"moveDate\":\"2026-11-02\",\"time\":\"09:00\",\"slots\":[\"t26\"]},\"quote\":{\"total\":515,\"crew\":2,\"hours\":3},\"payments\":{}}'" null)" "and books one straight away, lined up in a slot (Oct 25: the call center puts the move in a slot; dispatch picks the truck)"
check $JESS "0|1|t26|" "select (select count(*) from docs where path='jobs/n2')||'|'||(select count(*) from docs where path='sched/n2')||'|'||(select data->'d'->'slots'->>0 from docs where path='sched/n2')||'|'||coalesce((select data->'assign'->>'truckId' from docs where path='sched/n2'),'')" "the booking is on its schedule at once (the copy, with its slot and no truck), and the job itself isn't the call center's to read"
says $JESS "$(cc n3 "'{\"id\":\"n3\",\"status\":\"done\",\"d\":{\"name\":\"Done\"}}'" null)" "is a quote or a booking" "it can't make a job that's finished"
says $JESS "$(cc n4 "'{\"id\":\"n4\",\"status\":\"active\",\"d\":{\"name\":\"Running\"}}'" null)" "is a quote or a booking" "or one that's running"
says $JESS "$(cc n5 "'{\"id\":\"n5\",\"status\":\"quoted\",\"d\":{\"name\":\"Cheap\",\"discount\":\"100\"},\"payments\":{}}'" null)" "no payment and no discount" "or give a discount on a new quote"
says $JESS "$(cc n6 "'{\"id\":\"n6\",\"status\":\"booked\",\"d\":{\"name\":\"Paid?\"},\"payments\":{\"dp_x\":{\"id\":\"dp_x\",\"amt\":500}}}'" null)" "no payment and no discount" "or put a payment on one"
check $JESS closed "$(cc b1 "'{\"id\":\"b1\",\"status\":\"booked\",\"d\":{\"name\":\"Overwritten\"}}'" null)" "or save over a booked job: it's closed to it"
check $DIS "Priya Nair" "select data->'d'->>'name' from docs where path='jobs/b1'" "(the booked job is as it was)"
denied $JESS "$(job n7 '{"id":"n7","status":"quoted","d":{"name":"Direct"}}')" "the call center can't write a job directly"
denied $JESS "update docs set data=jsonb_set(data,'{d,notes}','\"x\"') where path='jobs/q1' returning 1" "or change one directly"
check $JESS "f" "select public.doc_patch('$O','jobs/q1','{\"d\":{\"notes\":\"x\"}}')" "or through doc_patch"
says $DIS "$(cc n8 "'{\"id\":\"n8\",\"status\":\"quoted\"}'" null)" "Only the call center" "cc_save is the call center's alone"
says $MARCUS "$(cc n8 "'{\"id\":\"n8\",\"status\":\"quoted\"}'" null)" "Only the call center" "and not a team member's in their own company"
says $JESS "select public.cc_save('$O2','jobs/n9','{\"id\":\"n9\",\"status\":\"quoted\"}',null)" "Only the call center" "and only for a company with the service"
says $JESS "select public.cc_save('$O','chat/m1','{\"from\":\"Jess\"}',null)" "saves jobs only" "and only for jobs"

# writing: open quotes
check $JESS ok "$(cc q1 null "'{\"quote\":{\"total\":530,\"crew\":3},\"d\":{\"notes\":\"Piano too\"}}'")" "the call center changes an open quote's price (crew, truck, hours)"
check $OWN "530|50|Piano too" "select (data->'quote'->>'total')||'|'||(data->'d'->>'discount')||'|'||(data->'d'->>'notes') from docs where path='jobs/q1'" "the new price stands, with the office's discount kept"
says $JESS "$(cc q1 null "'{\"d\":{\"discount\":\"80\"}}'")" "Only the office gives a discount" "changing the discount is refused"
says $JESS "$(cc q1 null "'{\"payments\":{\"p9\":{\"id\":\"p9\",\"amt\":50}}}'")" "doesn't take payments" "and so is a payment"
says $JESS "$(cc q1 null "'{\"status\":\"done\"}'")" "saves quotes, bookings and lost quotes" "and closing it out"
check $OWN "530|50" "select (data->'quote'->>'total')||'|'||(data->'d'->>'discount') from docs where path='jobs/q1'" "(nothing of those got in)"
check $JESS ok "$(cc q1 null "'{\"status\":\"booked\"}'")" "the call center books an open quote"
check $JESS "0|1" "select (select count(*) from docs where path='jobs/q1')||'|'||(select count(*) from docs where path='sched/q1')" "booked: off its quotes, onto its schedule"
check $JESS closed "$(cc q1 null "'{\"status\":\"quoted\"}'")" "and booking was its last change to it"
check $JESS ok "$(cc l1 null "'{\"status\":\"lost\"}'")" "the call center marks a lead lost"
check $JESS 0 "select count(*) from docs where path='jobs/l1'" "and it's off the open quotes"
check $JESS missing "$(cc zz null "'{\"status\":\"quoted\"}'")" "a change to a job that isn't there says so"
denied $JESS "delete from docs where collection='jobs' returning 1" "it can't delete a job"
denied $JESS "insert into docs(org_id,path,collection,doc_id,data) values ('$O','sched/z1','sched','z1','{\"id\":\"z1\",\"status\":\"booked\"}') returning 1" "or write a copy"
denied $JESS "update docs set data='{}' where collection in ('sched','ratecard') returning 1" "or change one"
denied $DIS "insert into docs(org_id,path,collection,doc_id,data) values ('$O','sched/z2','sched','z2','{\"id\":\"z2\",\"status\":\"booked\"}') returning 1" "the office can't write a schedule copy (only the database keeps them)"
denied $OWN "update docs set data='{\"rates\":{\"r2\":1}}' where path='ratecard/main' returning 1" "nor the owner the rate card copy"
denied $JESS "insert into docs(org_id,path,collection,doc_id,data) values ('$O','chat/m2','chat','m2','{\"from\":\"Jess\",\"ts\":1}') returning 1" "the call center has no chat"
check $JESS 1 "select count(*) from docs where collection='jobs' and doc_id='n1'" "it reads its own new quote"
check $OWN "Jess|true" "select (data->>'createdBy')||'|'||(data->>'createdCC') from docs where path='jobs/n1'" "the job keeps who made the quote, and that it was the call center"

# the copies follow the jobs and the settings, whoever changes them
as $DIS "update docs set data=jsonb_set(data,'{d,moveDate}','\"2026-10-31\"') where path='jobs/b1'" >/dev/null
check $JESS "2026-10-31" "select data->'d'->>'moveDate' from docs where path='sched/b1'" "dispatch moves a job: the copy moves too"
as $DIS "update docs set data=jsonb_set(data,'{status}','\"done\"') where path='jobs/a1'" >/dev/null
check $JESS 0 "select count(*) from docs where path='sched/a1'" "a job finished comes off the schedule"
as $DIS "delete from docs where path='jobs/b1'" >/dev/null
check $JESS 0 "select count(*) from docs where path='sched/b1'" "a job deleted too"
$P -d t -tA -c "set role service_role; update docs set data=jsonb_set(data,'{status}','\"active\"') where path='jobs/n2'" >/dev/null
check $JESS "active" "select data->>'status' from docs where path='sched/n2'" "and a change the server makes (it skips the rules) reaches the copy as well"
as $OWN "update docs set data=jsonb_set(data,'{rates,r2}','150') where path='org/settings'" >/dev/null
check $JESS "150" "select data->'rates'->>'r2' from docs where path='ratecard/main'" "the owner changes a rate: the rate card has it"
as $OWN "update docs set data=jsonb_set(data,'{contacts,Kim}','\"512-555-0106\"') where path='org/settings'" >/dev/null
check $JESS "false" "select (data ? 'contacts')::text from docs where path='ratecard/main'" "a new phone number never reaches it"
# the day plan (Oct 25): each truck's day, and how many movers there are and how many are off each day, never who
check $JESS "2|{}|false" "select concat_ws('|', data->'movers'->>'n', data->'movers'->>'off', (data ? 'truckDay')::text) from docs where path='ratecard/main'" "the rate card counts the movers (2) and nobody off"
as $OWN "update docs set data=data||'{\"truckDay\":{\"start\":\"06:30\",\"hours\":11,\"jobs\":3,\"gap\":45},\"daysOff\":{\"2026-10-30\":[\"Dee\",\"Dee\",\"Zed\"],\"2026-10-31\":[\"Marcus\",\"Dee\"],\"2026-11-01\":[\"Zed\"],\"bad\":\"Dee\"}}'::jsonb where path='org/settings'" >/dev/null
check $JESS "06:30|11|3|45|2|1|2|false|false" "select concat_ws('|', data->'truckDay'->>'start', data->'truckDay'->>'hours', data->'truckDay'->>'jobs', data->'truckDay'->>'gap', data->'movers'->>'n', data->'movers'->'off'->>'2026-10-30', data->'movers'->'off'->>'2026-10-31', (data->'movers'->'off' ? '2026-11-01')::text, (data->'movers'->'off' ? 'bad')::text) from docs where path='ratecard/main'" "the owner sets the trucks' day and marks days off: the copy has the day and the counts (a name twice counts once, someone not on the crew not at all)"
check $JESS "false|false|false" "select (data ? 'daysOff')::text||'|'||(data::text like '%Dee%')::text||'|'||(data::text like '%Marcus%')::text from docs where path='ratecard/main'" "and never who: no names in it"
as $OWN "update docs set data=data-'crew' where path='org/settings'" >/dev/null
check $JESS "false" "select (data ? 'movers')::text from docs where path='ratecard/main'" "no crew list: no counts (the trucks alone decide)"

# the service switched off, and a team member removed
pg "delete from cc_orgs where org_id='$O'" >/dev/null
check $JESS "0||" "select (select count(*) from docs where org_id='$O')||'|'||coalesce((select string_agg(name, ',') from my_orgs()),'')||'|'||coalesce((select string_agg(name, ',') from orgs),'')" "switched off: the team reads nothing of Acme, and it's off their list"
says $JESS "$(cc n10 "'{\"id\":\"n10\",\"status\":\"quoted\"}'" null)" "Only the call center" "and can't save there"
pg "insert into cc_orgs(org_id,on_by) values ('$O','richie')" >/dev/null
pg "delete from tally_cc_team where email='zoe@x.com'" >/dev/null
check $ZOE "0|" "select (select count(*) from docs)||'|'||coalesce((select string_agg(name, ',') from my_orgs()),'')" "Zoe off the team: nothing"
check $JESS "Acme Moving" "select string_agg(name, ',') from my_orgs()" "Jess, still on it, has Acme back"

# ---------- a database set up before the call center (the live one), then supabase-callcenter.sql ----------
setup u
$P -d u -f tests/sql/before-callcenter.sql
DB=u
O=$(as $OWN "select public.create_org('Acme Moving')")
$P -d u -tA -c "insert into members(org_id,user_id,email,staff,role) values ('$O','$DIS','x','Dispatch','dispatch')" >/dev/null
as $DIS "$(job b1 "$BOOK")" >/dev/null
as $OWN "$(doc $O org/settings "$SETTINGS")" >/dev/null
same "$(pg "select count(*) from docs where collection in ('sched','ratecard')")" 0 "before: no copies"
says $JESS "select public.claim_cc_team()" "does not exist" "before: no call center team"
$P -d u -f supabase/sql/supabase-callcenter.sql
$P -d u -f supabase/sql/supabase-callcenter.sql
same "$(defs u)" "$(defs t)" "after supabase-callcenter.sql: the tables, rules, functions, constraints and triggers are exactly a fresh install's"
pg "insert into tally_cc_team(email,name) values ('jess@x.com','Jess')" >/dev/null; pg "insert into cc_orgs(org_id) values ('$O')" >/dev/null
check $JESS "true" "select public.claim_cc_team()::text" "after: Tally admin adds Jess and switches Acme on"
check $JESS "b1|0|140" "select string_agg(doc_id,',')||'|'||(select count(*) from docs where collection='jobs')||'|'||(select data->'rates'->>'r2' from docs where path='ratecard/main') from docs where collection='sched'" "and the jobs booked before it are on her schedule, with the rate card there too (copied when the file ran)"
[ $FAILS = 0 ] || exit 1
