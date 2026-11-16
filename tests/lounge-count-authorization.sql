BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $test$
BEGIN
  IF public.lounge_recent_msg_count('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222') <> 0 THEN RAISE EXCEPTION 'Unexpected synthetic own count'; END IF;
  BEGIN
    PERFORM public.lounge_recent_msg_count('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'Foreign count accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.lounge_recent_msg_count(NULL,'22222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'Null user accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $test$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $test$
BEGIN
  BEGIN
    PERFORM public.lounge_recent_msg_count('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'Missing identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $test$;
RESET ROLE;
DO $test$
BEGIN
  IF has_function_privilege('anon','public.lounge_recent_msg_count(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execute retained'; END IF;
  IF NOT has_function_privilege('authenticated','public.lounge_recent_msg_count(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Authenticated execute lost'; END IF;
END $test$;
ROLLBACK;
SELECT 'Lounge count ownership and anonymous-access checks passed' AS result;
