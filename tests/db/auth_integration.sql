-- Isolated fixture: installed integration, raw role entrypoints, no test lock.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.has_global_lock() RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
  AND classid=1128351301 AND objid=1 AND objsubid=2 AND granted)
$$;
SELECT pg_temp.assert_true(NOT pg_temp.has_global_lock(),'fresh transaction before account operations');
SET LOCAL ROLE supabase_auth_admin;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('11111111-1111-4111-8111-111111111111','synthetic-signup@example.invalid','{"display_name":"Synthetic signup"}');
INSERT INTO auth.sessions(id,user_id) VALUES('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111');
UPDATE auth.users SET raw_user_meta_data='{"display_name":"Synthetic metadata edit"}' WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='11111111-1111-4111-8111-111111111111';
RESET ROLE;
SELECT pg_temp.assert_true(NOT pg_temp.has_global_lock(),'signup, session FK, metadata and modeled soft-delete UPDATE do not serialize behind chat');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.profiles WHERE id='11111111-1111-4111-8111-111111111111' AND email='synthetic-signup@example.invalid'),'exact profile creation trigger copies signup email');
SELECT pg_temp.assert_true((SELECT prosecdef AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres,service_role=X/postgres}' FROM pg_proc WHERE oid='public.handle_new_user()'::regprocedure),'signup hook security and ACL match catalog');
SET LOCAL ROLE authenticated;
UPDATE public.profiles SET display_name='Synthetic profile edit',avatar_url='https://example.invalid/avatar' WHERE id='11111111-1111-4111-8111-111111111111';
RESET ROLE;
SELECT pg_temp.assert_true(NOT pg_temp.has_global_lock(),'ordinary profile presentation edit does not take global');
SELECT pg_temp.assert_true((SELECT display_name='Synthetic profile edit' AND updated_at IS NOT NULL FROM public.profiles WHERE id='11111111-1111-4111-8111-111111111111'),'profile update and timestamp trigger preserved');
SELECT pg_temp.assert_true((SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=""','lock_timeout=2s']::text[] FROM pg_proc WHERE oid='public.concierge_auth_statement_v1()'::regprocedure),'standalone lock guard is INVOKER with empty path and bounded lock wait');
SELECT pg_temp.assert_true(NOT has_schema_privilege('supabase_auth_admin','concierge_private','USAGE'),'Auth owner has no private access');
SELECT pg_temp.assert_true(NOT has_table_privilege('supabase_auth_admin','public.profiles','DELETE'),'Auth owner has no direct profile deletion rights');
SELECT pg_temp.assert_true(NOT has_function_privilege('supabase_auth_admin','public.concierge_auth_statement_v1()','EXECUTE'),'Auth owner needs no direct helper execute grant');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.concierge_auth_statement_v1()','EXECUTE'),'browser has no direct helper execute grant');
SET LOCAL ROLE supabase_auth_admin;
DELETE FROM auth.users WHERE id='11111111-1111-4111-8111-111111111111';
RESET ROLE;
SELECT pg_temp.assert_true(pg_temp.has_global_lock(),'raw Auth deletion invokes installed statement guard');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='11111111-1111-4111-8111-111111111111'),'raw Auth deletion cascades created profile');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM auth.sessions WHERE user_id='11111111-1111-4111-8111-111111111111'),'raw Auth deletion cascades prior session reference');
ROLLBACK;

BEGIN;
SET LOCAL ROLE supabase_auth_admin;
UPDATE auth.users SET id=id WHERE false;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=1128351301 AND objid=1 AND objsubid=2 AND granted)
 THEN RAISE EXCEPTION 'auth identity statement guard did not run before row selection'; END IF;
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE signature text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.cs_record_gallery_payment(jsonb,uuid,uuid,integer)',
  'public.cs_reserve_ticket(uuid,uuid)','public.cs_record_ticket_payment(uuid,jsonb)'] LOOP
  IF NOT (SELECT prosecdef AND pg_get_userbyid(proowner)='postgres' FROM pg_proc WHERE oid=signature::regprocedure)
   OR NOT has_function_privilege('service_role',signature,'EXECUTE')
   OR has_function_privilege('anon',signature,'EXECUTE')
   OR has_function_privilege('authenticated',signature,'EXECUTE')
   OR has_function_privilege('supabase_auth_admin',signature,'EXECUTE')
   THEN RAISE EXCEPTION 'commerce RPC ownership/security/ACL changed: %',signature; END IF;
 END LOOP;
END $$;
ROLLBACK;
