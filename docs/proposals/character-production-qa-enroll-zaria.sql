-- REVIEW ONLY: exactly one private QA candidate. No media copy or publication.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_user<>session_user OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Reviewed direct PG17 installer required'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') THEN RAISE EXCEPTION 'Unexpected owner SET'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing original bootstrap context'; END IF;
 IF EXISTS(SELECT 1 FROM public.cs_character_promo_drafts WHERE id='7edd4058-9184-4411-9a95-bad175e974ea' OR promo_key='generated-qa-zaria-gallery-canary-20261114') THEN RAISE EXCEPTION 'Candidate already exists; reconcile, never duplicate'; END IF;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE qe_members ON COMMIT DROP AS SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members;
CREATE TEMP TABLE qe_drafts ON COMMIT DROP AS SELECT to_jsonb(d) row FROM public.cs_character_promo_drafts d;
CREATE TEMP TABLE qe_plans ON COMMIT DROP AS SELECT to_jsonb(d) row FROM public.cs_character_promo_delivery_plans d;
CREATE TEMP TABLE qe_qa ON COMMIT DROP AS SELECT to_jsonb(d) row FROM public.cs_character_promo_qa_checks d;
CREATE TEMP TABLE qe_candidate(capsule jsonb,stamp timestamptz) ON COMMIT DROP;
GRANT SELECT,INSERT,UPDATE ON qe_candidate TO character_production_owner;
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
SET LOCAL ROLE character_production_owner;
LOCK TABLE character_production.jobs,character_production.budgets,character_production.approved_slots,character_production.schedules IN SHARE MODE;
CREATE TEMP TABLE qe_rows ON COMMIT DROP AS SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x;
CREATE TEMP TABLE qe_targets ON COMMIT DROP AS SELECT to_jsonb(x) row FROM character_production.qa_targets x;
CREATE TEMP TABLE qe_receipts ON COMMIT DROP AS SELECT to_jsonb(x) row FROM character_production.qa_ingestion_receipts x;
DO $$ DECLARE j character_production.jobs; a character_production.approved_slots; BEGIN
 SELECT * INTO j FROM character_production.jobs WHERE key='zaria-gallery-image-canary-20261114' FOR UPDATE;
 SELECT * INTO a FROM character_production.approved_slots WHERE key='zaria-gallery-image-canary-20261114' FOR UPDATE;
 IF j.key IS NULL OR j.digest IS DISTINCT FROM '01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3' OR j.task IS DISTINCT FROM 'c8246007ce21cee14e38f409b4492967' OR j.state IS DISTINCT FROM 'pending_qa' OR j.sha IS DISTINCT FROM '018615557e88f67a26ee97136376bfdde215fe2cd2ca6e274c6d48825c116658' OR j.bytes IS DISTINCT FROM 4023955 OR j.bucket IS DISTINCT FROM 'character-production-private' OR j.object_path IS DISTINCT FROM j.digest||'/'||j.sha||'.mp4' OR j.slot IS DISTINCT FROM $slot${"key":"zaria-gallery-image-canary-20261114","characterId":"zaria-solenne","script":"Welcome to the Gallery at Café Sativa. I'm Zaria Solenne. Every piece has a story, and I'd love to help you discover yours.","canonicalRevision":"3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8","voiceId":"5zneNR4v1Uw5AjIZ9Un4","portraitSha256":"ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca","providerBindingRevision":"a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0","provider":"heygen","model":"avatar_iv","durationSeconds":9,"authorizationId":"keith-one-existing-credit-canary-40c-20261114","authorizationExpiresAt":1794680700000,"period":"2026-11","quoteCents":35,"periodCapCents":40}$slot$::jsonb OR a.slot IS DISTINCT FROM j.slot OR a.digest IS DISTINCT FROM j.digest OR a.enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'Exact original recovered output proof missing'; END IF;
 IF EXISTS(SELECT 1 FROM character_production.qa_targets WHERE job_key=j.key OR promo_id='7edd4058-9184-4411-9a95-bad175e974ea') OR EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts WHERE job_key=j.key OR promo_id='7edd4058-9184-4411-9a95-bad175e974ea') THEN RAISE EXCEPTION 'Original output already enrolled; reconcile only'; END IF;
 INSERT INTO qe_candidate(capsule) VALUES(jsonb_build_object('characterId',j.slot->>'characterId','script',j.slot->>'script','key',j.key,'digest',j.digest,'taskId',j.task,'sha256',j.sha,'bytes',j.bytes));
END $$;
RESET ROLE;
WITH inserted AS (
 INSERT INTO public.cs_character_promo_drafts(id,character_id,promo_key,specialty,title,spoken_script,visual_brief,intended_channel,duration_seconds,status,evidence,linked_event_id,actual_social_account,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at)
 SELECT '7edd4058-9184-4411-9a95-bad175e974ea',capsule->>'characterId','generated-qa-zaria-gallery-canary-20261114','Gallery concierge','Zaria: Gallery welcome (generated QA candidate)',capsule->>'script','Use only the existing owner-approved Café Sativa Gallery scene, SHA256 dc56e882a2beffac334927ecfe33b908568cbf2bc49065b0336259fca8fc784e. Approval reference Sentinel_674253e2c98c8191bdfe85de68dbb52d. No inferred or new scene details; final QA is still required.','private_qa_only',8,'draft',jsonb_build_object('source','existing_character_production_output','recovery','manual_original_output_recovery','automatedIngestionProven',false,'publicationApproved',false,'original',capsule),NULL,NULL,NULL,NULL,NULL,NULL,NULL FROM qe_candidate
 RETURNING updated_at)
UPDATE qe_candidate SET stamp=(SELECT updated_at FROM inserted);
SET LOCAL ROLE character_production_owner;
INSERT INTO character_production.qa_targets(job_key,digest,promo_id,expected_updated_at,enabled) SELECT capsule->>'key',capsule->>'digest','7edd4058-9184-4411-9a95-bad175e974ea',stamp,true FROM qe_candidate;
DO $$ BEGIN
 IF (SELECT count(*) FROM character_production.qa_targets WHERE job_key='zaria-gallery-image-canary-20261114' AND promo_id='7edd4058-9184-4411-9a95-bad175e974ea' AND digest='01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3' AND enabled)<>1 THEN RAISE EXCEPTION 'Exact target missing'; END IF;
 IF EXISTS((SELECT row FROM qe_targets EXCEPT SELECT to_jsonb(x) FROM character_production.qa_targets x WHERE job_key<>'zaria-gallery-image-canary-20261114') UNION ALL (SELECT to_jsonb(x) FROM character_production.qa_targets x WHERE job_key<>'zaria-gallery-image-canary-20261114' EXCEPT SELECT row FROM qe_targets)) OR EXISTS((SELECT row FROM qe_receipts EXCEPT SELECT to_jsonb(x) FROM character_production.qa_ingestion_receipts x) UNION ALL (SELECT to_jsonb(x) FROM character_production.qa_ingestion_receipts x EXCEPT SELECT row FROM qe_receipts)) THEN RAISE EXCEPTION 'Prior targets or receipts changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x) (SELECT * FROM actual EXCEPT SELECT * FROM qe_rows) UNION ALL (SELECT * FROM qe_rows EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Original job/budget/slot/schedule changed'; END IF;
END $$;
RESET ROLE;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.cs_character_promo_drafts WHERE id='7edd4058-9184-4411-9a95-bad175e974ea' AND character_id='zaria-solenne' AND status='draft' AND duration_seconds=8 AND video_asset_path IS NULL AND audio_asset_path IS NULL AND voice_approved_at IS NULL AND video_qa_approved_at IS NULL AND publication_approved_at IS NULL AND actual_social_account IS NULL) THEN RAISE EXCEPTION 'Candidate must remain unapproved and without media'; END IF;
 IF EXISTS((SELECT row FROM qe_drafts EXCEPT SELECT to_jsonb(x) FROM public.cs_character_promo_drafts x WHERE id<>'7edd4058-9184-4411-9a95-bad175e974ea') UNION ALL (SELECT to_jsonb(x) FROM public.cs_character_promo_drafts x WHERE id<>'7edd4058-9184-4411-9a95-bad175e974ea' EXCEPT SELECT row FROM qe_drafts)) OR EXISTS((SELECT row FROM qe_plans EXCEPT SELECT to_jsonb(x) FROM public.cs_character_promo_delivery_plans x) UNION ALL (SELECT to_jsonb(x) FROM public.cs_character_promo_delivery_plans x EXCEPT SELECT row FROM qe_plans)) OR EXISTS((SELECT row FROM qe_qa EXCEPT SELECT to_jsonb(x) FROM public.cs_character_promo_qa_checks x) UNION ALL (SELECT to_jsonb(x) FROM public.cs_character_promo_qa_checks x EXCEPT SELECT row FROM qe_qa)) THEN RAISE EXCEPTION 'Existing draft/plan/QA changed'; END IF;
 IF EXISTS((SELECT * FROM qe_members EXCEPT SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members) UNION ALL (SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members EXCEPT SELECT * FROM qe_members)) OR pg_has_role(current_user,'character_production_owner','SET') THEN RAISE EXCEPTION 'Owner context not restored'; END IF;
END $$;
COMMIT;
