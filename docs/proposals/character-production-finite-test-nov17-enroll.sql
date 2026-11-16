-- OFFLINE NOV17 ENROLLMENT. Additional $0.10, not a refund/replacement.
-- Approval IDs must be supplied after future approval; never enroll before Nov17.
-- UNEXECUTED finite configuration. Requires action-time approval for temporary
-- restricted-owner SET membership. Default ROLLBACK. No schema/runtime grants.
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>session_user OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Direct PG17 postgres required'; END IF;
 IF clock_timestamp()>='2026-11-18T06:00:00Z'::timestamptz OR clock_timestamp()<'2026-11-17T06:00:00Z'::timestamptz OR to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')<>'2026-11-17' THEN RAISE EXCEPTION 'Finite approval window expired'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT(rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Inert owner required'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole OR member='character_production_owner'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member='postgres'::regrole AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'Existing membership changed'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected installer permission'; END IF;
 IF public.cs_cafe_metricool_is_admin('54b71f3f-19e1-46f0-99e2-28993463caf8') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Owner no longer admin'; END IF;
END $$;
CREATE TEMP TABLE private_test_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE private_test_acl ON COMMIT DROP AS
 SELECT 'schema' kind,oid::text identity,nspowner owner,nspacl::text acl FROM pg_namespace WHERE nspname IN('public','character_production')
 UNION ALL SELECT 'function',oid::text,proowner,proacl::text FROM pg_proc WHERE pronamespace IN('public'::regnamespace,'character_production'::regnamespace)
 UNION ALL SELECT 'relation',oid::text,relowner,relacl::text FROM pg_class WHERE relnamespace IN('public'::regnamespace,'character_production'::regnamespace);
DO $$ BEGIN
 IF 'REPLACE_WITH_NOV17_APPROVAL_MESSAGE_ID' !~ '^Sentinel_[a-f0-9]{32}$' THEN RAISE EXCEPTION 'Future approval message ID required'; END IF;
END $$;
GRANT character_production_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
SET LOCAL ROLE character_production_owner;
LOCK TABLE character_production.text_replenishment_budgets,character_production.text_replenishment_attempts,character_production.finite_test_authority,character_production.finite_test_occurrence,character_production.preparation_occurrences IN EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM character_production.finite_test_authority) OR EXISTS(SELECT 1 FROM character_production.finite_test_occurrence) OR EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts WHERE key='daily:2026-11-17:zaria-solenne') OR EXISTS(SELECT 1 FROM character_production.preparation_occurrences WHERE text_key='daily:2026-11-17:zaria-solenne') THEN RAISE EXCEPTION 'Existing Nov17 context preserved; no adoption/retry'; END IF;
END $$;
INSERT INTO character_production.text_replenishment_budgets(id,period,model,input_micro_usd,output_micro_usd,max_cost_cents,cap_cents,reserved_cents,rate_evidence,expires_at,enabled)
VALUES('a3db37d4-8a82-4aa0-a2f1-91dc14e5464b','2026-11','claude-haiku-4-5-20251001',1,5,10,10,0,'https://platform.claude.com/docs/en/about-claude/pricing Haiku4.5 input $1/M output $5/M; reverify before enrollment; additional private Nov17 sample','2026-11-18T06:00:00Z',true);
INSERT INTO character_production.finite_test_authority(singleton,id,actor_id,reference,owner_message_ids,source_scope,budget_id,authorized_at,expires_at,speech_max_chars,included_credits_only,enabled)
VALUES(true,'b705d45a-5e27-4491-ad9c-d8ca8aa5b9e7','54b71f3f-19e1-46f0-99e2-28993463caf8','zaria-private-test-20261117',ARRAY['REPLACE_WITH_NOV17_APPROVAL_MESSAGE_ID'],'{"characterId":"zaria-solenne","roomKey":"gallery","assignmentRole":"primary_host","topic":"art-observation","venueAssetId":"b84f9f4e-af29-476e-b55b-38e146a847c7","venueSha256":"89c327c4a82c3249f8bd1937891cd9dae6a8a34be556fbdab605168e2b845a04","verifiedCollaborators":[]}','a3db37d4-8a82-4aa0-a2f1-91dc14e5464b','2026-11-17T06:00:00Z','2026-11-18T06:00:00Z',250,true,true);
RESET ROLE;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ BEGIN
 IF pg_has_role(current_user,'character_production_owner','SET') THEN RAISE EXCEPTION 'Temporary permission not removed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM private_test_members) UNION ALL (SELECT * FROM private_test_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(WITH current_acl AS (
 SELECT 'schema' kind,oid::text identity,nspowner owner,nspacl::text acl FROM pg_namespace WHERE nspname IN('public','character_production')
 UNION ALL SELECT 'function',oid::text,proowner,proacl::text FROM pg_proc WHERE pronamespace IN('public'::regnamespace,'character_production'::regnamespace)
 UNION ALL SELECT 'relation',oid::text,relowner,relacl::text FROM pg_class WHERE relnamespace IN('public'::regnamespace,'character_production'::regnamespace))
 (SELECT * FROM current_acl EXCEPT SELECT * FROM private_test_acl) UNION ALL (SELECT * FROM private_test_acl EXCEPT SELECT * FROM current_acl)) THEN RAISE EXCEPTION 'ACL or owner changed'; END IF;
END $$;
-- Default is an offline/rehearsal transaction. Change only the final statement
-- to COMMIT after explicit approval and exact successful rollback rehearsal.
ROLLBACK;
