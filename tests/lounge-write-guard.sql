BEGIN;
DO $$ BEGIN
  IF has_column_privilege('authenticated','public.profiles','is_admin','UPDATE')
     OR has_column_privilege('authenticated','public.profiles','is_staff','UPDATE')
     OR NOT has_column_privilege('authenticated','public.profiles','display_name','UPDATE')
     OR NOT has_table_privilege('service_role','public.profiles','UPDATE') THEN RAISE EXCEPTION 'Profile grants failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM public.profiles LIMIT 1),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
CREATE TEMP TABLE guard_test_room(id uuid);
INSERT INTO public.lounge_rooms(slug,name,min_read_tier,min_post_tier)
VALUES ('audit-'||gen_random_uuid()::text,'Rollback guard test','explorer','explorer')
RETURNING id;
INSERT INTO guard_test_room SELECT id FROM public.lounge_rooms WHERE name='Rollback guard test';
GRANT SELECT ON guard_test_room TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE room uuid; msg uuid; rec record; i integer;
BEGIN
  SELECT id INTO room FROM guard_test_room LIMIT 1;
  INSERT INTO public.lounge_messages(room_id,user_id,author_name,author_tier,is_staff,content,created_at)
  VALUES(room,auth.uid(),'FORGED','vip',true,'first',now()-interval '1 year') RETURNING * INTO rec;
  msg:=rec.id;
  IF rec.is_staff IS DISTINCT FROM (SELECT (is_staff OR is_admin) FROM public.profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'Staff badge not authoritative'; END IF;
  BEGIN
    INSERT INTO public.lounge_messages(room_id,user_id,author_name,author_tier,content)
    VALUES(room,gen_random_uuid(),'fake','vip','foreign');
    RAISE EXCEPTION 'Foreign author accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.soft_delete_lounge_message(gen_random_uuid()); RAISE EXCEPTION 'Unknown deletion accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.lounge_messages(room_id,user_id,author_name,author_tier,content)
    VALUES(room,auth.uid(),'fake','vip','   ');
    RAISE EXCEPTION 'Blank content accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF rec.author_name='FORGED' OR rec.created_at < now()-interval '5 seconds' THEN RAISE EXCEPTION 'Forged identity/time accepted'; END IF;
  BEGIN UPDATE public.profiles SET is_admin=true WHERE id=auth.uid(); RAISE EXCEPTION 'Admin escalation accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.lounge_messages SET content='edited' WHERE id=msg; RAISE EXCEPTION 'Editing accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.soft_delete_lounge_message(msg);
  FOR i IN 2..10 LOOP
    INSERT INTO public.lounge_messages(room_id,user_id,author_name,author_tier,content)
    VALUES(room,auth.uid(),'FORGED','vip','audit');
  END LOOP;
  BEGIN
    INSERT INTO public.lounge_messages(room_id,user_id,author_name,author_tier,content)
    VALUES(room,auth.uid(),'FORGED','vip','eleventh');
    RAISE EXCEPTION 'Rate limit bypassed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'lounge_rate_limited' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
ROLLBACK;