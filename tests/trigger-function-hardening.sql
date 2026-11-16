BEGIN;
DO $test$
DECLARE name text; config text[]; public_role text;
BEGIN
  FOREACH name IN ARRAY ARRAY['bump_message_count','touch_updated_at','update_updated_at','handle_new_user'] LOOP
    SELECT p.proconfig INTO config FROM pg_proc p WHERE p.oid=('public.'||name||'()')::regprocedure;
    IF NOT EXISTS(SELECT 1 FROM unnest(config) value WHERE replace(value,'"','')='search_path=') THEN RAISE EXCEPTION 'Missing fixed empty search_path: %',name; END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['fn_passport_welcome_email','handle_new_user'] LOOP
    FOREACH public_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(public_role,'public.'||name||'()','EXECUTE') THEN RAISE EXCEPTION 'Public trigger execution: % %',name,public_role; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role','public.'||name||'()','EXECUTE') THEN RAISE EXCEPTION 'Missing service execution: %',name; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgfoid='public.handle_new_user()'::regprocedure AND NOT tgisinternal) THEN RAISE EXCEPTION 'Signup trigger binding lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.passport_waitlist'::regclass AND tgfoid='public.fn_passport_welcome_email()'::regprocedure AND NOT tgisinternal) THEN RAISE EXCEPTION 'Welcome trigger binding lost'; END IF;
END $test$;
ROLLBACK;
SELECT 'trigger function configuration and privilege checks passed' AS result;
