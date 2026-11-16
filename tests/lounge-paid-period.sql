BEGIN;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM public.profiles LIMIT 1),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
CREATE TEMP TABLE expiry_rooms(id uuid,kind text);
WITH r AS(INSERT INTO public.lounge_rooms(slug,name,min_read_tier,min_post_tier)
VALUES('audit-expiry-'||gen_random_uuid()::text,'Rollback expiry VIP','vip','vip') RETURNING id)
INSERT INTO expiry_rooms SELECT id,'vip' FROM r;
WITH r AS(INSERT INTO public.lounge_rooms(slug,name,min_read_tier,min_post_tier)
VALUES('audit-expiry-'||gen_random_uuid()::text,'Rollback expiry free','explorer','explorer') RETURNING id)
INSERT INTO expiry_rooms SELECT id,'free' FROM r;
GRANT SELECT ON expiry_rooms TO authenticated;
UPDATE public.memberships SET tier='vip',status='active',current_period_end=now()+interval '1 day' WHERE user_id=auth.uid();
SET LOCAL ROLE authenticated;
DO $$ DECLARE room uuid;
BEGIN
 IF NOT public.lounge_tier_allowed('vip') THEN RAISE EXCEPTION 'Future paid period denied'; END IF;
 SELECT id INTO room FROM expiry_rooms WHERE kind='vip';
 INSERT INTO public.lounge_messages(room_id,user_id,author_name,author_tier,content)
 VALUES(room,auth.uid(),'ignored','explorer','paid access fixture');
END $$;
RESET ROLE;
UPDATE public.memberships SET current_period_end=now()-interval '1 second' WHERE user_id=auth.uid();
SET LOCAL ROLE authenticated;
DO $$ DECLARE room uuid; badge text;
BEGIN
 IF public.lounge_tier_allowed('vip') OR public.lounge_tier_allowed('regular') THEN RAISE EXCEPTION 'Expired paid period accepted'; END IF;
 IF NOT public.lounge_tier_allowed('explorer') THEN RAISE EXCEPTION 'Free access lost'; END IF;
 SELECT id INTO room FROM expiry_rooms WHERE kind='vip';
 IF EXISTS(SELECT 1 FROM public.lounge_messages WHERE room_id=room) THEN RAISE EXCEPTION 'Expired read allowed'; END IF;
 BEGIN
  INSERT INTO public.lounge_messages(room_id,user_id,author_name,author_tier,content)
  VALUES(room,auth.uid(),'ignored','vip','must reject');
  RAISE EXCEPTION 'Expired post allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT id INTO room FROM expiry_rooms WHERE kind='free';
 INSERT INTO public.lounge_messages(room_id,user_id,author_name,author_tier,content)
 VALUES(room,auth.uid(),'ignored','vip','free post fixture') RETURNING author_tier INTO badge;
 IF badge <> 'explorer' THEN RAISE EXCEPTION 'Expired paid badge retained'; END IF;
END $$;
RESET ROLE;
UPDATE public.memberships SET current_period_end=NULL WHERE user_id=auth.uid();
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.lounge_tier_allowed('regular') THEN RAISE EXCEPTION 'Missing period accepted'; END IF; END $$;
RESET ROLE;
UPDATE public.memberships SET current_period_end=now()+interval '1 day',status='past_due' WHERE user_id=auth.uid();
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.lounge_tier_allowed('vip') THEN RAISE EXCEPTION 'Past-due membership accepted'; END IF; END $$;
RESET ROLE;
ROLLBACK;