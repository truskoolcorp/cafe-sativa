-- Rollback-only verification; does not create a user or change paid access.
BEGIN;
SET LOCAL ROLE service_role;
DO $test$
DECLARE member public.memberships%ROWTYPE; affected integer;
BEGIN
  SELECT * INTO member FROM public.memberships LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existing membership for rollback-only verification'; END IF;
  -- Write the same period value: only the existing timestamp trigger changes revision.
  UPDATE public.memberships SET current_period_end=member.current_period_end
    WHERE user_id=member.user_id AND updated_at=member.updated_at;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Current revision rejected'; END IF;
  UPDATE public.memberships SET current_period_end=member.current_period_end
    WHERE user_id=member.user_id AND updated_at=member.updated_at;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Stale revision accepted'; END IF;
  INSERT INTO public.memberships(user_id,tier,status)
    VALUES(member.user_id,member.tier,member.status) ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Duplicate insert replaced existing membership'; END IF;
END $test$;
ROLLBACK;
SELECT 'membership compare-and-swap rollback checks passed' AS result;
