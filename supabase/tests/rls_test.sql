-- LOCAL TEST ONLY: RLS/privilege assertions. Run after emulate_supabase_auth.sql and the migration.
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'owner@test.invalid'),
                              ('00000000-0000-0000-0000-00000000000b', 'other@test.invalid');
insert into public.app_owner (user_id, username) values ('00000000-0000-0000-0000-00000000000a', 'shoura');
insert into public.tariff_versions (owner_id, version, label, is_original, data)
  values ('00000000-0000-0000-0000-00000000000a', 1, 'original', true, '{"schema":1}');

create or replace function pg_temp.expect_fail(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'PASS (blocked) %: %', label, sqlerrm; return; end;
  raise exception 'FAIL: % was allowed', label;
end $$;
create or replace function pg_temp.expect_count(q text, n int, label text) returns void language plpgsql as $$
declare c int;
begin execute 'select count(*) from (' || q || ') s' into c;
  if c <> n then raise exception 'FAIL: % returned % rows, expected %', label, c, n; end if;
  raise notice 'PASS % (% rows)', label, c;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- anon: no access at all
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select pg_temp.expect_fail('select * from public.quotes', 'anon select quotes');
select pg_temp.expect_fail('select * from public.clients', 'anon select clients');
select pg_temp.expect_fail('select * from public.tariff_versions', 'anon select tariffs');
select pg_temp.expect_fail('select * from public.app_owner', 'anon select app_owner');
select pg_temp.expect_fail($$insert into public.clients (owner_id, name) values ('00000000-0000-0000-0000-00000000000a','x')$$, 'anon insert client');
select pg_temp.expect_fail('select public.is_app_owner()', 'anon call is_app_owner');
reset role;

-- other authenticated user (not the registered owner)
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000b"}', false);
select pg_temp.expect_count('select * from public.tariff_versions', 0, 'other sees no tariffs');
select pg_temp.expect_fail($$insert into public.clients (name) values ('intruder')$$, 'other insert own client');
select pg_temp.expect_fail($$insert into public.app_owner (user_id, username) values ('00000000-0000-0000-0000-00000000000b','evil')$$, 'other self-grant app_owner');
select pg_temp.expect_fail($$update public.app_owner set user_id = '00000000-0000-0000-0000-00000000000b'$$, 'other hijack app_owner');
select pg_temp.expect_fail('select * from public.app_owner', 'other read app_owner');
select pg_temp.expect_fail($$insert into public.user_settings (idle_minutes) values (30)$$, 'other create settings');
reset role;

-- owner
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', false);
select pg_temp.expect_count('select * from public.tariff_versions', 1, 'owner sees original tariff');
insert into public.user_settings (idle_minutes) values (30);
insert into public.clients (id, name, contact) values ('10000000-0000-0000-0000-000000000001', 'عميل تجريبي', '0100');
insert into public.quotes (id, request_id, client_id, snapshot) values ('20000000-0000-0000-0000-000000000001', gen_random_uuid(), '10000000-0000-0000-0000-000000000001', '{"a":1}');
select pg_temp.expect_count('select * from public.quotes', 1, 'owner sees own quote');
update public.quotes set title = 'renamed' where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.expect_fail($$update public.quotes set snapshot = '{"b":2}'$$, 'owner rewrite quote snapshot (immutable)');
select pg_temp.expect_fail($$update public.quotes set owner_id = '00000000-0000-0000-0000-00000000000b'$$, 'owner reassign quote owner');
select pg_temp.expect_fail($$insert into public.clients (owner_id, name) values ('00000000-0000-0000-0000-00000000000b','spoof')$$, 'owner insert row for other user');
select pg_temp.expect_fail($$insert into public.tariff_versions (version, label, is_original, data) values (9, 'fake original', true, '{}')$$, 'owner create original via API');
insert into public.tariff_versions (version, label, data) values (99, 'edit', '{"schema":1}');
select pg_temp.expect_count('select * from public.tariff_versions where version = 2', 1, 'version auto-assigned sequentially');
select pg_temp.expect_fail($$update public.tariff_versions set data = '{}'$$, 'owner mutate tariff version');
select pg_temp.expect_fail($$delete from public.tariff_versions$$, 'owner delete tariff version');
select pg_temp.expect_fail($$insert into public.quotes (request_id, snapshot) select request_id, snapshot from public.quotes limit 1$$, 'duplicate request_id');
select pg_temp.expect_fail($$update public.user_settings set idle_minutes = 1$$, 'idle minutes out of range');
reset role;

-- cross-owner relation: a client belonging to B cannot be linked from A's quote
insert into public.clients (id, owner_id, name) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'B client');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a"}', false);
select pg_temp.expect_count('select * from public.clients', 1, 'owner does not see B rows');
select pg_temp.expect_fail($$update public.quotes set client_id = '10000000-0000-0000-0000-00000000000b'$$, 'link quote to foreign client');
select pg_temp.expect_count($$select * from public.clients where id = '10000000-0000-0000-0000-00000000000b'$$, 0, 'B client invisible');
-- deleting a client keeps the quote and clears the link only
delete from public.clients where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect_count('select * from public.quotes where client_id is null and owner_id is not null', 1, 'quote kept, link cleared');
reset role;

-- B is not app owner even with own rows inserted by a superuser
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000b"}', false);
select pg_temp.expect_count('select * from public.clients', 0, 'non-owner cannot read even own-owned rows');
reset role;
\echo ALL RLS TESTS PASSED
