-- REVIEW ONLY: exact private one-shot canary, temporary owner context restored before commit.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ DECLARE sig text; BEGIN
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'PostgreSQL17 required'; END IF;
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected reviewed direct installer'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') THEN RAISE EXCEPTION 'Unexpected preexisting SET owner'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing exact bootstrap role authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole))<>3 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole) AND (member<>current_user::regrole OR grantor=current_user::regrole OR NOT admin_option OR inherit_option OR set_option)) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole)) THEN RAISE EXCEPTION 'Unexpected production role membership baseline'; END IF;
 FOREACH sig IN ARRAY ARRAY['public.character_production_authorization(text,text)','public.character_production_broker_authorized(jsonb)','public.character_production_claim(jsonb,text)','public.character_production_due(text,text,integer)','public.character_production_failed(jsonb)','public.character_production_output(jsonb,text,bigint)','public.character_production_output_status(jsonb,text,bigint)','public.character_production_pending(text,text,integer)','public.character_production_submitted(text,text,text,text)','public.character_production_unknown(text,text,text)'] LOOP
 IF to_regprocedure(sig) IS NULL OR (SELECT proowner FROM pg_proc WHERE oid=to_regprocedure(sig))<>'character_production_owner'::regrole OR NOT has_function_privilege('service_role',sig,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected function baseline %',sig; END IF;
 END LOOP;
END $$;
-- Capture the real bootstrap grantor, not a guessed postgres grantor.
CREATE TEMP TABLE backend_members_before ON COMMIT DROP AS
 SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members
 WHERE roleid IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole,'service_role'::regrole)
 OR member IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole,'service_role'::regrole);
CREATE TEMP TABLE backend_functions_before ON COMMIT DROP AS
 SELECT p.oid,a.grantee,a.grantor,a.privilege_type,a.is_grantable FROM pg_proc p
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.pronamespace='character_production'::regnamespace OR (p.pronamespace='public'::regnamespace AND p.proname LIKE 'character_production_%');
CREATE TEMP TABLE backend_objects_before ON COMMIT DROP AS
 SELECT c.oid,c.relacl FROM pg_class c WHERE c.relnamespace='character_production'::regnamespace;
CREATE TEMP TABLE backend_schemas_before ON COMMIT DROP AS
 SELECT oid,nspacl FROM pg_namespace WHERE oid IN ('character_production'::regnamespace,'public'::regnamespace);
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
SET LOCAL ROLE character_production_owner;
-- BEGIN EXACT REVIEWED CANARY BODY
LOCK TABLE character_production.budgets, character_production.approved_slots, character_production.schedules, character_production.jobs IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM character_production.budgets) OR EXISTS(SELECT 1 FROM character_production.approved_slots) OR EXISTS(SELECT 1 FROM character_production.schedules) OR EXISTS(SELECT 1 FROM character_production.jobs) THEN RAISE EXCEPTION 'Expected empty ledger; stop and reconcile'; END IF;
 IF floor(extract(epoch FROM clock_timestamp())*1000)>=1794680700000 OR to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')<>'2026-11' THEN RAISE EXCEPTION 'Canary window invalid'; END IF;
END $$;
INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen','2026-11',40,0,true);
INSERT INTO character_production.approved_slots(key,slot,digest,enabled) VALUES('zaria-gallery-image-canary-20261114','{"key":"zaria-gallery-image-canary-20261114","characterId":"zaria-solenne","script":"Welcome to the Gallery at Café Sativa. I''m Zaria Solenne. Every piece has a story, and I''d love to help you discover yours.","canonicalRevision":"3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8","voiceId":"5zneNR4v1Uw5AjIZ9Un4","portraitSha256":"ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca","providerBindingRevision":"a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0","provider":"heygen","model":"avatar_iv","durationSeconds":9,"authorizationId":"keith-one-existing-credit-canary-40c-20261114","authorizationExpiresAt":1794680700000,"period":"2026-11","quoteCents":35,"periodCapCents":40}'::jsonb,'01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3',true);
INSERT INTO character_production.schedules(key,digest,scheduled_at,not_after,enabled) VALUES('zaria-gallery-image-canary-20261114','01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3',to_timestamp(1794677700000/1000.0),to_timestamp(1794680700000/1000.0),true);
DO $$ BEGIN
 IF (SELECT count(*) FROM character_production.budgets) IS DISTINCT FROM 1::bigint
 OR (SELECT count(*) FROM character_production.approved_slots) IS DISTINCT FROM 1::bigint
 OR (SELECT count(*) FROM character_production.schedules) IS DISTINCT FROM 1::bigint
 OR (SELECT count(*) FROM character_production.jobs) IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'Canary row counts differ'; END IF;
 IF NOT EXISTS(SELECT 1 FROM character_production.budgets WHERE provider='heygen' AND period='2026-11' AND cap_cents=40 AND reserved_cents=0 AND enabled=true) THEN RAISE EXCEPTION 'Canary budget differs'; END IF;
 IF NOT EXISTS(SELECT 1 FROM character_production.approved_slots WHERE key='zaria-gallery-image-canary-20261114' AND slot='{"key":"zaria-gallery-image-canary-20261114","characterId":"zaria-solenne","script":"Welcome to the Gallery at Café Sativa. I''m Zaria Solenne. Every piece has a story, and I''d love to help you discover yours.","canonicalRevision":"3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8","voiceId":"5zneNR4v1Uw5AjIZ9Un4","portraitSha256":"ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca","providerBindingRevision":"a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0","provider":"heygen","model":"avatar_iv","durationSeconds":9,"authorizationId":"keith-one-existing-credit-canary-40c-20261114","authorizationExpiresAt":1794680700000,"period":"2026-11","quoteCents":35,"periodCapCents":40}'::jsonb AND digest='01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3' AND enabled=true) THEN RAISE EXCEPTION 'Canary exact slot differs'; END IF;
 IF NOT EXISTS(SELECT 1 FROM character_production.schedules WHERE key='zaria-gallery-image-canary-20261114' AND digest='01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3' AND scheduled_at='2026-11-14T17:35:00Z'::timestamptz AND not_after='2026-11-14T18:25:00Z'::timestamptz AND enabled=true) THEN RAISE EXCEPTION 'Canary schedule differs'; END IF;
 IF floor(extract(epoch FROM clock_timestamp())*1000)>=1794680700000 THEN RAISE EXCEPTION 'Canary window expired'; END IF;
END $$;
-- END EXACT REVIEWED CANARY BODY
RESET ROLE;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE r text; checked_function record; BEGIN
 IF EXISTS(
 (SELECT * FROM pg_temp.backend_members_before EXCEPT SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members)
 UNION ALL
 (SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole,'service_role'::regrole) OR member IN ('character_production_owner'::regrole,'character_production_generator'::regrole,'character_production_output_broker'::regrole,'service_role'::regrole) EXCEPT SELECT * FROM pg_temp.backend_members_before)
 ) THEN RAISE EXCEPTION 'Original bootstrap memberships changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.backend_objects_before b FULL JOIN pg_class c ON c.oid=b.oid AND c.relnamespace='character_production'::regnamespace WHERE b.oid IS NOT NULL AND (c.oid IS NULL OR c.relacl IS DISTINCT FROM b.relacl)) OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='character_production'::regnamespace AND NOT EXISTS(SELECT 1 FROM pg_temp.backend_objects_before b WHERE b.oid=c.oid)) THEN RAISE EXCEPTION 'Table or sequence ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.backend_schemas_before b JOIN pg_namespace n USING(oid) WHERE b.nspacl IS DISTINCT FROM n.nspacl) THEN RAISE EXCEPTION 'Schema ACL changed'; END IF;
 -- Exact before ACL, with no added or removed function privileges.
 IF EXISTS(
 WITH expected AS (SELECT * FROM pg_temp.backend_functions_before),
 actual AS (SELECT p.oid,a.grantee,a.grantor,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='character_production'::regnamespace OR (p.pronamespace='public'::regnamespace AND p.proname LIKE 'character_production_%'))
 (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
 ) THEN RAISE EXCEPTION 'Unexpected function ACL delta'; END IF;
 IF pg_has_role('postgres','character_production_owner','SET') OR pg_has_role('postgres','character_production_owner','USAGE') THEN RAISE EXCEPTION 'Temporary SET not removed'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 FOR checked_function IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'character_production_%' LOOP
 IF has_function_privilege(r,checked_function.oid,'EXECUTE') THEN RAISE EXCEPTION 'Public API execution leak'; END IF;
 END LOOP; END LOOP;
 IF has_schema_privilege('service_role','character_production','USAGE') OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' AND has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE')) THEN RAISE EXCEPTION 'Unexpected direct ledger privilege'; END IF;
END $$;
COMMIT;
