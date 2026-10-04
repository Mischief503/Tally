set -e
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
D=$(mktemp -d); $PGBIN/initdb -D $D -U postgres >/dev/null
$PGBIN/pg_ctl -D $D -o "-k $D -p 55432 -c listen_addresses=''" -l $D/log start >/dev/null
P="psql -h $D -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
for T in uuid text; do
$P -c "drop database if exists t" ; $P -c "create database t"
$P -d t <<SQL
do \$r\$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end \$r\$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as \$\$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid \$\$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.members(org_id $T, user_id uuid, email text, staff text, role text, ts bigint, primary key(org_id,user_id));
alter table public.members enable row level security;
create policy m_self on public.members for select to authenticated using (user_id = auth.uid());
grant select on public.members to authenticated;
SQL
$P -d t -f supabase/sql/supabase-twilio.sql
$P -d t -c "grant all on all tables in schema public to service_role"
O1=11111111-1111-1111-1111-111111111111; O2=22222222-2222-2222-2222-222222222222
OWN=aaaaaaaa-0000-0000-0000-000000000001; CREW=aaaaaaaa-0000-0000-0000-000000000002; DIS=aaaaaaaa-0000-0000-0000-000000000003; OTHER=aaaaaaaa-0000-0000-0000-000000000004
$P -d t <<SQL
insert into members values ('$O1','$OWN','o@x','Owner','owner',0),('$O1','$CREW','c@x','Marcus','crew',0),('$O1','$DIS','d@x','Dispatch','dispatch',0),('$O2','$OTHER','z@x','Zed','owner',0);
insert into comm_lines(org_id,phone_number) values ('$O1','+15125550000');
insert into comm_log(org_id,job_id,channel,direction,purpose,staff,status) values
 ('$O1','j1','sms','out','assigned','Marcus','sent'),('$O1','j1','sms','out','assigned','Dee','sent'),('$O1','j1','call','in','callback',null,'missed'),('$O2','j9','sms','out','assigned','Zed','sent');
insert into comm_job_state(org_id,job_id) values ('$O1','j1');
SQL
check(){ # who expect sql
 got=$($P -d t -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $3" 2>&1 | tail -1)
 if [ "$got" = "$2" ]; then echo "PASS [$T] $4"; else echo "FAIL [$T] $4: got '$got' want '$2'"; FAILS=1; fi; }
FAILS=0
check $OWN 3 "select count(*) from comm_log" "owner sees all 3 rows of own company"
check $DIS 3 "select count(*) from comm_log" "dispatch sees all 3"
check $CREW 1 "select count(*) from comm_log" "crew sees only their own row"
check $OTHER 1 "select count(*) from comm_log" "other company sees only its own"
check $OWN 1 "select count(*) from comm_lines" "owner reads own line"
check $OTHER 0 "select count(*) from comm_lines" "other company cannot read the line"
check $CREW 1 "select count(*) from comm_lines" "crew can read own line (to show the Call option)"
check $OWN "ERROR:  permission denied for table comm_job_state" "select count(*) from comm_job_state" "app cannot read job state"
check $OWN "ERROR:  permission denied for table comm_log" "insert into comm_log(org_id,channel,direction,purpose) values ('$O1','sms','out','x')" "owner cannot write the log"
check $OWN "ERROR:  permission denied for table comm_lines" "update comm_lines set phone_number='+15550001111'" "owner cannot change the line"
check $OTHER "ERROR:  permission denied for table comm_lines" "insert into comm_lines values ('$O2','+15125559999')" "stranger cannot claim a line"
check "" 0 "select count(*) from comm_log" "signed-in with no company sees nothing"
 got=$($P -d t -tA -c "set role anon; select count(*) from comm_log" 2>&1|tail -1); [ "$got" = "ERROR:  permission denied for table comm_log" ] && echo "PASS [$T] anon locked out" || { echo "FAIL anon: $got"; FAILS=1; }
$P -d t -f supabase/sql/supabase-twilio.sql && echo "PASS [$T] migration re-runs cleanly"
[ $FAILS = 0 ] || exit 1
done
$PGBIN/pg_ctl -D $D stop >/dev/null
