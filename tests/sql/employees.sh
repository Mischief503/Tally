#!/usr/bin/env bash
# Employee profiles: who can read them, sign-in by email, access following the profile, and the
# private documents bucket (Supabase storage stood in for by a small stub with the same columns).
set -e
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
D=$(mktemp -d); $PGBIN/initdb -D $D -U postgres >/dev/null
$PGBIN/pg_ctl -D $D -o "-k $D -p 55434 -c listen_addresses=''" -l $D/log start >/dev/null
trap '$PGBIN/pg_ctl -D $D stop >/dev/null' EXIT
P="psql -h $D -p 55434 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database t"
$P -d t <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
create publication supabase_realtime;
-- the parts of Supabase storage the rules touch
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to authenticated;
insert into auth.users values
 ('aaaaaaaa-0000-0000-0000-000000000001','own@x.com', now()),
 ('aaaaaaaa-0000-0000-0000-000000000002','Mike@X.com', now()),
 ('aaaaaaaa-0000-0000-0000-000000000003','dana@x.com', null),
 ('aaaaaaaa-0000-0000-0000-000000000004','lee@x.com', now()),
 ('aaaaaaaa-0000-0000-0000-000000000005','other@x.com', now()),
 ('aaaaaaaa-0000-0000-0000-000000000006','mike.new@x.com', now()),
 ('aaaaaaaa-0000-0000-0000-000000000007','stranger@x.com', now());
SQL
$P -d t -f supabase/sql/supabase-schema-v2.sql
$P -d t -f supabase/sql/supabase-employees.sql
$P -d t -f supabase/sql/supabase-employees.sql   # runs again cleanly
OWN=aaaaaaaa-0000-0000-0000-000000000001; MIKE=aaaaaaaa-0000-0000-0000-000000000002; DANA=aaaaaaaa-0000-0000-0000-000000000003
LEE=aaaaaaaa-0000-0000-0000-000000000004; OTHER=aaaaaaaa-0000-0000-0000-000000000005; MIKE2=aaaaaaaa-0000-0000-0000-000000000006
STRANGER=aaaaaaaa-0000-0000-0000-000000000007
as(){ $P -d t -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tail -1; }
FAILS=0
check(){ got=$(as "$1" "$3"); if [ "$got" = "$2" ]; then echo "PASS $4"; else echo "FAIL $4: got '$got' want '$2'"; FAILS=1; fi; }
denied(){ got=$(as "$1" "$2"); case "$got" in *ERROR*) echo "PASS $3";; *) if [ "$got" = "0" ] || [ -z "$got" ]; then echo "PASS $3"; else echo "FAIL $3: got '$got'"; FAILS=1; fi;; esac; }
says(){ got=$($P -d t -tA -c "set role authenticated; set request.jwt.claim.sub='$1'; $2" 2>&1 | tr '\n' ' '); case "$got" in *"$3"*) echo "PASS $4";; *) echo "FAIL $4: got '$got'"; FAILS=1;; esac; }

O=$(as $OWN "select public.create_org('Acme Moving')")
O2=$(as $OTHER "select public.create_org('Other Co')")
$P -d t -c "insert into docs(org_id,path,collection,doc_id,data) values ('$O','org/settings','org','settings','{\"company\":\"Acme\",\"contacts\":{\"Mike\":\"5035550100\"}}')"

# ---- the owner adds people
EM=$(as $OWN "insert into employees(org_id,name,role,email,info,notes) values ('$O',' Mike ','crew',' MIKE@x.com ','{\"payRate\":\"22\",\"phone\":\"5035550100\",\"ssnLast4\":\"1234\"}','Late twice in May') returning id")
ED=$(as $OWN "insert into employees(org_id,name,role,email) values ('$O','Dana','dispatch','dana@x.com') returning id")
EL=$(as $OWN "insert into employees(org_id,name,role) values ('$O','Lee','lead') returning id")
check $OWN "Mike|mike@x.com" "select name||'|'||email from employees where id='$EM'" "name and email are tidied (trimmed, lower case)"
says $OWN "insert into employees(org_id,name) values ('$O','mike')" "duplicate key" "two people can't share a name"
says $OWN "insert into employees(org_id,name,email) values ('$O','Zed','not-an-email')" "does not look right" "a bad email is refused"
says $OWN "insert into employees(org_id,name,email) values ('$O','Zed2','mike@x.com')" "duplicate key" "two profiles can't share a sign-in email"
check $OWN 3 "select count(*) from employees" "owner sees every profile"

# ---- nobody else reads the table
check $OTHER 0 "select count(*) from employees" "another company sees none"
denied $OTHER "insert into employees(org_id,name) values ('$O','Spy') returning 1" "another company can't add people to ours"
denied $OTHER "update employees set notes='x' where id='$EM' returning 1" "another company can't change ours"
check $STRANGER 0 "select count(*) from employees" "a signed-in stranger sees none"
got=$($P -d t -tA -c "set role anon; select count(*) from employees" 2>&1|tail -1); case "$got" in *"permission denied"*) echo "PASS anon locked out";; *) echo "FAIL anon: $got"; FAILS=1;; esac

# ---- sign-in links the profile by confirmed email
check $MIKE 1 "select public.claim_invites()" "Mike signs in: his profile is found by email (any capitals)"
check $OWN "$MIKE" "select user_id from employees where id='$EM'" "the profile now points at Mike's login"
check $MIKE "Mike|crew" "select staff||'|'||role from members where org_id='$O' and user_id=auth.uid()" "Mike is in the company as Mike, crew"
check $MIKE 0 "select public.claim_invites()" "signing in again changes nothing"
check $MIKE 0 "select count(*) from employees" "Mike can't read the employee table"
check $MIKE "Mike|crew|22|1234|false" "select (p->>'name')||'|'||(p->>'role')||'|'||(p->'info'->>'payRate')||'|'||(p->'info'->>'ssnLast4')||'|'||(p ? 'notes')::text from (select public.my_profile('$O') p) x" "Mike reads his own profile, pay included, without the owner's notes"
check $DANA 0 "select public.claim_invites()" "an unconfirmed email links nothing"
check $DANA 0 "select count(*) from members where user_id=auth.uid()" "and gets no access"
check $STRANGER "" "select coalesce(public.my_profile('$O')::text,'')" "someone without a profile gets nothing back"

# ---- people update only their own contact details
check $MIKE "5035550199|12 Elm St|Ana|22|crew" "select (p->'info'->>'phone')||'|'||(p->'info'->>'address')||'|'||(p->'info'->>'emergencyName')||'|'||(p->'info'->>'payRate')||'|'||(p->>'role') from (select public.update_my_profile('$O','{\"phone\":\"5035550199\",\"address\":\"12 Elm St\",\"emergencyName\":\"Ana\",\"payRate\":\"99\",\"role\":\"owner\"}') p) x" "Mike changes phone, address, emergency contact; his pay and role stay"
check $OWN "5035550199" "select data->'contacts'->>'Mike' from docs where org_id='$O' and path='org/settings'" "his new phone reaches the company contact list"
check $MIKE "crew" "select role from members where org_id='$O' and user_id=auth.uid()" "and he is still crew"
says $STRANGER "select public.update_my_profile('$O','{\"phone\":\"1\"}')" "No profile" "someone without a profile can't update one"

# ---- access follows the profile
as $OWN "update employees set role='lead' where id='$EM'" >/dev/null
check $MIKE "lead" "select role from members where org_id='$O' and user_id=auth.uid()" "owner makes Mike a lead: his access follows"
as $OWN "update employees set active=false where id='$EM'" >/dev/null
check $MIKE 0 "select count(*) from members where org_id='$O' and user_id=auth.uid()" "owner turns Mike off: his access ends"
check $MIKE "" "select coalesce(public.my_profile('$O')::text,'')" "and his profile is closed to him"
check $MIKE 0 "select public.claim_invites()" "signing in again doesn't bring him back"
as $OWN "update employees set active=true where id='$EM'" >/dev/null
check $MIKE 1 "select count(*) from members where org_id='$O' and user_id=auth.uid()" "owner turns Mike back on: access returns"
as $OWN "update employees set email='mike.new@x.com' where id='$EM'" >/dev/null
check $OWN "" "select coalesce(user_id::text,'') from employees where id='$EM'" "a new sign-in email unlinks the old login"
check $MIKE 0 "select count(*) from members where org_id='$O' and user_id=auth.uid()" "and the old login loses access"
check $MIKE2 1 "select public.claim_invites()" "the new address signs in and is linked"
check $MIKE2 "Mike|lead" "select staff||'|'||role from members where org_id='$O' and user_id=auth.uid()" "as Mike, lead"

# ---- linking by hand (the join-code path) only for people who asked or are already in
says $OWN "update employees set user_id='$STRANGER' where id='$EL'" "has not asked" "owner can't attach a stranger's login"
CODE=$($P -d t -tA -c "select join_code from orgs where id='$O'")
check $LEE "Acme Moving" "select public.request_join('$CODE')" "Lee asks to join with the code"
as $OWN "update employees set user_id='$LEE' where id='$EL'" >/dev/null
check $LEE "Lee|lead" "select staff||'|'||role from members where org_id='$O' and user_id=auth.uid()" "owner links Lee's request to his profile: he's in as Lee, lead"
check $LEE 0 "select count(*) from access_requests where user_id=auth.uid()" "and his request is cleared"
as $OWN "delete from employees where id='$EL'" >/dev/null
check $LEE 0 "select count(*) from members where org_id='$O' and user_id=auth.uid()" "deleting a profile removes that person's access"

# ---- the owner's own profile
EO=$(as $OWN "insert into employees(org_id,name,role,email) values ('$O','Richie','owner','own@x.com') returning id")
check $OWN 1 "select public.claim_invites()" "the owner's own profile links to the owner"
check $OWN "Richie|owner" "select staff||'|'||role from members where org_id='$O' and user_id=auth.uid()" "the owner shows as Richie, owner"
says $OWN "update employees set active=false where id='$EO'" "your own access" "the owner can't turn themselves off"
says $OWN "delete from employees where id='$EO'" "your own access" "or delete their own profile"
as $OWN "update employees set role='crew' where id='$EO'" >/dev/null
check $OWN "owner" "select role from members where org_id='$O' and user_id=auth.uid()" "or lower their own role"

# ---- private documents
F="$O/$EM/i9.pdf"; FD="$O/$ED/w4.pdf"
check $OWN 1 "insert into storage.objects(bucket_id,name) values ('employee-docs','$F') returning 1" "owner adds a document to Mike's profile"
check $OWN 1 "insert into storage.objects(bucket_id,name) values ('employee-docs','$FD') returning 1" "and one to Dana's"
check $MIKE2 1 "select count(*) from storage.objects where bucket_id='employee-docs'" "Mike sees only his own documents"
check $MIKE2 1 "insert into storage.objects(bucket_id,name) values ('employee-docs','$O/$EM/license.jpg') returning 1" "Mike adds his license photo"
denied $MIKE2 "insert into storage.objects(bucket_id,name) values ('employee-docs','$FD-x') returning 1" "Mike can't add to Dana's folder"
denied $MIKE2 "delete from storage.objects where name='$F' returning 1" "Mike can't delete documents"
check $OTHER 0 "select count(*) from storage.objects where bucket_id='employee-docs'" "another company sees none of them"
denied $OWN "insert into storage.objects(bucket_id,name) values ('employee-docs','$O/not-an-id/x.pdf') returning 1" "a malformed path is refused"
denied $OWN "insert into storage.objects(bucket_id,name) values ('employee-docs','$O2/$EM/x.pdf') returning 1" "a path naming another company is refused"
check $OWN 1 "delete from storage.objects where name='$F' returning 1" "owner deletes a document"
got=$($P -d t -tA -c "select public from storage.buckets where id='employee-docs'"); [ "$got" = "f" ] && echo "PASS the bucket is private" || { echo "FAIL bucket public: $got"; FAILS=1; }
[ $FAILS = 0 ] || exit 1
