#!/usr/bin/env bash
# The multi-company schema and its role rules, then the Twilio tables on top of it.
set -e
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
D=$(mktemp -d); $PGBIN/initdb -D $D -U postgres >/dev/null
$PGBIN/pg_ctl -D $D -o "-k $D -p 55433 -c listen_addresses=''" -l $D/log start >/dev/null
trap '$PGBIN/pg_ctl -D $D stop >/dev/null' EXIT
P="psql -h $D -p 55433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database t"
$P -d t <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
create publication supabase_realtime;
insert into auth.users values
 ('aaaaaaaa-0000-0000-0000-000000000001','own@x'),('aaaaaaaa-0000-0000-0000-000000000002','crew@x'),
 ('aaaaaaaa-0000-0000-0000-000000000003','dis@x'),('aaaaaaaa-0000-0000-0000-000000000004','lead@x'),
 ('aaaaaaaa-0000-0000-0000-000000000005','new@x'),('aaaaaaaa-0000-0000-0000-000000000006','other@x');
SQL
$P -d t -f supabase/sql/supabase-schema-v2.sql
$P -d t -f supabase/sql/supabase-schema-v2.sql   # runs again cleanly
$P -d t -f supabase/sql/supabase-twilio.sql
OWN=aaaaaaaa-0000-0000-0000-000000000001; CREW=aaaaaaaa-0000-0000-0000-000000000002; DIS=aaaaaaaa-0000-0000-0000-000000000003
LEAD=aaaaaaaa-0000-0000-0000-000000000004; NEW=aaaaaaaa-0000-0000-0000-000000000005; OTHER=aaaaaaaa-0000-0000-0000-000000000006
as(){ $P -d t -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tail -1; }
FAILS=0
check(){ got=$(as "$1" "$3"); if [ "$got" = "$2" ]; then echo "PASS $4"; else echo "FAIL $4: got '$got' want '$2'"; FAILS=1; fi; }
denied(){ got=$(as "$1" "$2"); case "$got" in *ERROR*) echo "PASS $3";; *) if [ "$got" = "0" ] || [ -z "$got" ]; then echo "PASS $3"; else echo "FAIL $3: got '$got'"; FAILS=1; fi;; esac; }

O=$(as $OWN "select public.create_org('Acme Moving')")
O2=$(as $OTHER "select public.create_org('Other Co')")
CODE=$($P -d t -tA -c "select join_code from orgs where id='$O'")
check $OWN "owner" "select role from my_orgs() where id='$O'" "creator becomes owner"
check $OWN 6 "select length(join_code) from my_orgs() where id='$O'" "owner sees the 6-character code"
for U in $CREW $DIS $LEAD $NEW; do as $U "select public.request_join('$(echo $CODE | tr A-Z a-z)')" >/dev/null; done
check $NEW "t" "select pending from my_orgs()" "a request shows as pending"
check $NEW "" "select coalesce(join_code,'') from my_orgs()" "pending person does not see the code"
check $NEW "" "select public.request_join('ZZZZZZ')" "wrong code returns nothing"
check $OWN 5 "select count(*) from people('$O')" "owner sees self and 4 requests"
check $CREW 0 "select count(*) from people('$O')" "requester sees no one yet"
denied $CREW "insert into members(org_id,user_id,email,role) values ('$O','$CREW','crew@x','owner')" "requester cannot let themselves in"
# owner approves three, as the app does: upsert the member row, delete the request
for p in "$CREW:Marcus:crew" "$DIS:Dee:dispatch" "$LEAD:Lena:lead"; do IFS=: read U N R <<<"$p"
  as $OWN "insert into members(org_id,user_id,email,staff,role,ts) values ('$O','$U','x','$N','$R',1) on conflict (org_id,user_id) do update set staff=excluded.staff, role=excluded.role" >/dev/null
  as $OWN "delete from access_requests where org_id='$O' and user_id='$U'" >/dev/null; done
check $CREW 4 "select count(*) from members" "crew sees the 4 people in the company"
check $CREW 0 "select count(*) from access_requests" "crew sees no one else's request"
check $OWN 1 "select count(*) from access_requests" "owner sees the one waiting"
denied $DIS "update members set role='owner' where user_id='$DIS'" "dispatch cannot promote themselves"
check $OWN "ERROR:  new row violates row-level security policy for table \"members\"" "update members set role='crew' where user_id='$OWN'" "owner cannot demote themselves"
denied $OWN "delete from members where user_id='$OWN' returning 1" "owner cannot remove themselves"
check $OTHER 0 "select count(*) from members where org_id='$O'" "another company sees none of our people"

# documents
ins(){ as $1 "insert into docs(org_id,path,collection,doc_id,data) values ('$O','$2/$3','$2','$3','$4') on conflict (org_id,path) do update set data=excluded.data returning 1"; }
check $DIS 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/j1','jobs','j1','{\"id\":\"j1\",\"assign\":{\"crew\":[\"Marcus\",\"Lena\"]}}'),('$O','jobs/j2','jobs','j2','{\"id\":\"j2\",\"assign\":{\"crew\":[\"Dee\"]}}') returning 1" | sed 's/^/ /')" "dispatch creates jobs" || true
check $OWN 2 "select count(*) from docs where collection='jobs'" "owner sees both jobs"
check $CREW 1 "select count(*) from docs where collection='jobs'" "crew sees only the job they're on"
check $LEAD "j1" "select doc_id from docs where collection='jobs'" "lead sees only their job"
check $CREW 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/j1','jobs','j1','{\"id\":\"j1\",\"phases\":{\"loadStart\":1},\"assign\":{\"crew\":[\"Marcus\",\"Lena\"]}}') on conflict (org_id,path) do update set data=excluded.data returning 1")" "crew saves their job (upsert)"
denied $CREW "insert into docs(org_id,path,collection,doc_id,data) values ('$O','jobs/j9','jobs','j9','{\"assign\":{\"crew\":[\"Marcus\"]}}')" "crew cannot create a job"
denied $CREW "update docs set data='{}' where path='jobs/j2' returning 1" "crew cannot touch a job they're not on"
denied $CREW "update docs set data=jsonb_set(data,'{assign,crew}','[\"Dee\"]') where path='jobs/j1' returning 1" "crew cannot take themselves off and keep editing"
denied $CREW "delete from docs where path='jobs/j1' returning 1" "crew cannot delete a job"
check $DIS 1 "delete from docs where path='jobs/j2' returning 1" "dispatch deletes a job"
check $OWN 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','org/settings','org','settings','{\"company\":\"Acme\"}') returning 1")" "owner saves settings"
denied $DIS "update docs set data='{}' where path='org/settings' returning 1" "dispatch cannot change settings"
check $CREW 1 "select count(*) from docs where path='org/settings'" "crew reads settings"
check $LEAD 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','vault/v1','vault','v1','{\"last4\":\"4242\"}') returning 1")" "lead saves a card on file (last four)"
check $CREW 0 "select count(*) from docs where collection='vault'" "crew cannot see cards on file"
check $CREW 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','shifts/s1','shifts','s1','{\"who\":\"Marcus\",\"inAt\":1}') returning 1")" "crew clocks themselves in"
denied $CREW "insert into docs(org_id,path,collection,doc_id,data) values ('$O','shifts/s2','shifts','s2','{\"who\":\"Lena\",\"inAt\":1}')" "crew cannot clock in someone else"
check $LEAD 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','shifts/s3','shifts','s3','{\"who\":\"Joe\",\"inAt\":1}') returning 1")" "lead runs the clock for the crew"
check $CREW 1 "select count(*) from docs where collection='shifts'" "crew sees only their own time"
check $CREW 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','locs/Marcus','locs','Marcus','{\"name\":\"Marcus\"}') returning 1")" "crew shares their location"
denied $CREW "insert into docs(org_id,path,collection,doc_id,data) values ('$O','locs/Lena','locs','Lena','{\"name\":\"Lena\"}')" "crew cannot post someone else's location"
check $CREW 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','chat/m1','chat','m1','{\"from\":\"Marcus\",\"ts\":1}') returning 1")" "crew sends chat"
check $LEAD 1 "delete from docs where path='chat/m1' returning 1" "old chat can be tidied by anyone"
check $CREW 1 "$(echo "insert into docs(org_id,path,collection,doc_id,data) values ('$O','photos/p1','photos','p1','{\"jobId\":\"j1\"}') returning 1")" "crew adds a photo"
check $OTHER 0 "select count(*) from docs where org_id='$O'" "another company sees none of our documents"
denied $OTHER "insert into docs(org_id,path,collection,doc_id,data) values ('$O','chat/x','chat','x','{}')" "another company cannot write into ours"
check $NEW 0 "select count(*) from docs" "a pending person sees nothing"
got=$($P -d t -tA -c "set role anon; select count(*) from docs" 2>&1|tail -1); case "$got" in *"permission denied"*) echo "PASS anon locked out";; *) echo "FAIL anon: $got"; FAILS=1;; esac
got=$($P -d t -tA -c "set role anon; select public.create_org('x')" 2>&1|tail -1); case "$got" in *"permission denied"*) echo "PASS anon cannot create a company";; *) echo "FAIL anon create: $got"; FAILS=1;; esac
# the Twilio tables follow the same roles
$P -d t -c "insert into comm_log(org_id,job_id,channel,direction,purpose,staff,status) values ('$O','j1','sms','out','assigned','Marcus','sent'),('$O','j1','sms','out','assigned','Lena','sent')"
check $DIS 2 "select count(*) from comm_log" "dispatch sees the whole call and text log"
check $CREW 1 "select count(*) from comm_log" "crew sees only their own texts"
check $OWN 3 "select count(*) from pg_publication_tables where pubname='supabase_realtime'" "live updates on docs, members, requests"
[ $FAILS = 0 ] || exit 1
