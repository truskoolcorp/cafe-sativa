CREATE OR REPLACE FUNCTION public.lounge_tier_allowed(p_minimum text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    p_minimum='explorer' OR EXISTS (
      SELECT 1 FROM public.memberships m WHERE m.user_id=auth.uid()
      AND m.status='active' AND m.current_period_end > now()
      AND ((p_minimum='regular' AND m.tier::text IN ('regular','vip'))
        OR (p_minimum='vip' AND m.tier::text='vip'))
    )
  );
$$;
REVOKE ALL ON FUNCTION public.lounge_tier_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lounge_tier_allowed(text) TO authenticated,service_role;
ALTER POLICY lounge_messages_read ON public.lounge_messages
USING (deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM public.lounge_rooms r WHERE r.id=lounge_messages.room_id
  AND public.lounge_tier_allowed(r.min_read_tier)
));
ALTER POLICY lounge_messages_insert ON public.lounge_messages
WITH CHECK (user_id=auth.uid() AND EXISTS (
  SELECT 1 FROM public.lounge_rooms r WHERE r.id=lounge_messages.room_id
  AND public.lounge_tier_allowed(r.min_post_tier)
));
CREATE OR REPLACE FUNCTION public.guard_lounge_message_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); staff boolean; display text; tier text; recent integer;
BEGIN
  IF actor IS NULL THEN RAISE insufficient_privilege USING MESSAGE = 'Sign in to write Lounge messages'; END IF;
  SELECT coalesce(p.is_staff OR p.is_admin,false),coalesce(nullif(btrim(p.display_name),''),'Member')
    INTO staff,display FROM public.profiles p WHERE p.id=actor;
  staff := coalesce(staff,false);
  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id <> actor AND NOT staff THEN RAISE insufficient_privilege USING MESSAGE='Message ownership required'; END IF;
    IF (NEW.id,NEW.room_id,NEW.user_id,NEW.author_name,NEW.author_tier,NEW.is_staff,NEW.content,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.room_id,OLD.user_id,OLD.author_name,OLD.author_tier,OLD.is_staff,OLD.content,OLD.created_at)
      OR OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
      RAISE insufficient_privilege USING MESSAGE='Only soft deletion is permitted';
    END IF;
    NEW.deleted_at := clock_timestamp(); NEW.deleted_by := actor;
    RETURN NEW;
  END IF;
  IF NEW.user_id <> actor THEN RAISE insufficient_privilege USING MESSAGE='Message ownership required'; END IF;
  NEW.content := btrim(NEW.content);
  IF NEW.content IS NULL OR char_length(NEW.content) NOT BETWEEN 1 AND 2000 THEN
    RAISE check_violation USING MESSAGE='Message must contain 1 to 2000 characters';
  END IF;
  -- Serialize every insert for the same author/room. Deleted messages count too.
  PERFORM pg_advisory_xact_lock(hashtextextended('lounge-write:'||actor::text||':'||NEW.room_id::text,0));
  SELECT count(*) INTO recent FROM public.lounge_messages
    WHERE user_id=actor AND room_id=NEW.room_id AND created_at > clock_timestamp()-interval '1 minute';
  IF recent >= 10 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='lounge_rate_limited'; END IF;
  SELECT m.tier::text INTO tier FROM public.memberships m WHERE m.user_id=actor AND m.status='active' AND m.current_period_end > now();
  NEW.author_name := coalesce(display,'Member'); NEW.author_tier := coalesce(tier,'explorer'); NEW.is_staff := staff;
  NEW.created_at := clock_timestamp(); NEW.deleted_at := NULL; NEW.deleted_by := NULL;
  RETURN NEW;
END;
$$;
