#!/usr/bin/env python3
"""Emit an inert exact-owner planner installer; never connect or execute SQL."""
from pathlib import Path
import hashlib
R=Path(__file__).resolve().parents[1]
names=['character-production-planner.sql','character-production-planner-policy-read.sql','character-production-planner-draft-helper.sql']
sources=[(R/'docs/proposals'/n).read_text() for n in names]
assert [hashlib.sha256(x.encode()).hexdigest() for x in sources]==['2af4122c887acea43ce63fa970d443a6d431b67d5c1ec754b70ea19849021264', '29ecf7fb8f2f5d9774aa4485ba7cf56155706afbacb4b923c9145c4fd7c76873', '41dd1f7d77a1e78a2c3c2163f79488cea474b6cd8334b0de69f8ff0c2088b59a']
def body(x):return x.split('\nBEGIN;',1)[1].rsplit('\nCOMMIT;',1)[0]
pre=r'''-- OFFLINE REVIEW ONLY. Prerequisites: reviewed recurring QA and HeyGen wallet
-- guard already installed. Empty planner, no runtime grants/rows/activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct reviewed PG17 installer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe owner baseline'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected temporary authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing exact bootstrap membership'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_drafts'::regclass AND relowner=current_user::regrole AND relrowsecurity AND NOT relforcerowsecurity) THEN RAISE EXCEPTION 'Unexpected source owner/RLS'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('qa_slot_bindings','heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') AND c.relkind='r' AND c.relowner='character_production_owner'::regrole AND c.relrowsecurity)<>4 OR to_regprocedure('public.character_production_qa_draft_unplanned(uuid)') IS NULL OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proowner='character_production_owner'::regrole AND ((p.proname='calendar_period' AND p.proargtypes='25 1184'::oidvector) OR (p.proname='heygen_spend_allowed' AND p.proargtypes='3802 25 20 25'::oidvector)))<>2 THEN RAISE EXCEPTION 'Reviewed recurring QA and wallet guard prerequisites required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cs_cafe_metricool_is_admin(uuid)') AND proowner=current_user::regrole AND prorettype='boolean'::regtype AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog']::text[]) OR NOT has_function_privilege('character_production_owner','public.cs_cafe_metricool_is_admin(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Reviewed source-owned boolean admin bridge required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('planning_policies','planning_records')) OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) AND proname IN ('character_production_plan','character_production_planned_draft','character_production_planning_policy','character_production_new_blank_draft','planning_record_immutable','planning_policy_revoke')) THEN RAISE EXCEPTION 'Planner already exists: reconcile'; END IF;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE pi_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE pi_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE pi_ns ON COMMIT DROP AS SELECT oid,nspacl,nspowner FROM pg_namespace WHERE nspname IN ('public','character_production');
CREATE TEMP TABLE pi_objects ON COMMIT DROP AS SELECT oid,relacl,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'character_production'::regnamespace);
CREATE TEMP TABLE pi_cols ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN (SELECT oid FROM pi_objects);
CREATE TEMP TABLE pi_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) AND prokind='f';
CREATE TEMP TABLE pi_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE pi_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
CREATE TEMP TABLE pi_rows(name text,row jsonb) ON COMMIT DROP;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 EXECUTE format('LOCK TABLE character_production.%I IN SHARE MODE',t.relname);
 EXECUTE format('INSERT INTO pi_rows SELECT %L,to_jsonb(x) FROM character_production.%I x',t.relname,t.relname);
 END LOOP;
END $$;
'''
mid=r'''
GRANT EXECUTE ON FUNCTION public.character_production_planned_draft(uuid,jsonb,text,text) TO postgres;
RESET ROLE;
'''
post=r'''
GRANT EXECUTE ON FUNCTION public.character_production_new_blank_draft(uuid,jsonb,text,text) TO character_production_owner;
SET LOCAL ROLE character_production_owner;
DO $$ DECLARE t record; BEGIN
 IF EXISTS(SELECT 1 FROM character_production.planning_policies) OR EXISTS(SELECT 1 FROM character_production.planning_records) THEN RAISE EXCEPTION 'Planner must install empty'; END IF;
 CREATE TEMP TABLE pi_rows_after(name text,row jsonb) ON COMMIT DROP;
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' AND relname NOT IN ('planning_policies','planning_records') LOOP
 EXECUTE format('INSERT INTO pi_rows_after SELECT %L,to_jsonb(x) FROM character_production.%I x',t.relname,t.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM pi_rows EXCEPT ALL SELECT * FROM pi_rows_after) UNION ALL (SELECT * FROM pi_rows_after EXCEPT ALL SELECT * FROM pi_rows)) THEN RAISE EXCEPTION 'Ledger data changed'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE f record; t record; own oid:='character_production_owner'::regrole; expected_owner oid; extra oid; BEGIN
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM pi_members) UNION ALL (SELECT * FROM pi_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_ns b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM b.nspacl OR n.nspowner IS DISTINCT FROM b.nspowner) THEN RAISE EXCEPTION 'Schema authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_objects b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM pi_cols b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR pg_get_functiondef(p.oid) IS DISTINCT FROM b.def) THEN RAISE EXCEPTION 'Existing function changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM pi_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM pi_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.data) THEN RAISE EXCEPTION 'Existing triggers changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM pi_source) UNION ALL (SELECT * FROM pi_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source rows changed'; END IF;
 FOR t IN SELECT * FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('planning_policies','planning_records') LOOP
 IF t.relkind<>'r' OR t.relowner<>own OR NOT t.relrowsecurity OR t.relforcerowsecurity OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'Planner table identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(t.relacl,acldefault('r',own)))), e AS (SELECT * FROM aclexplode(acldefault('r',own))) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Planner table ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('planning_policies','planning_records') AND relkind='r')<>2 THEN RAISE EXCEPTION 'Missing planner tables'; END IF;
 FOR f IN SELECT p.* FROM pg_proc p WHERE NOT EXISTS(SELECT 1 FROM pi_functions b WHERE b.oid=p.oid) AND p.pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) LOOP
 expected_owner:=CASE WHEN f.proname='character_production_new_blank_draft' THEN current_user::regrole::oid ELSE own END;
 extra:=CASE WHEN f.proname='character_production_new_blank_draft' THEN own WHEN f.proname='character_production_planned_draft' THEN current_user::regrole::oid ELSE NULL END;
 IF NOT (CASE f.proname
 WHEN 'planning_record_immutable' THEN f.pronamespace='character_production'::regnamespace AND f.proargtypes=''::oidvector AND f.prorettype='trigger'::regtype AND NOT f.prosecdef
 WHEN 'planning_policy_revoke' THEN f.pronamespace='character_production'::regnamespace AND f.proargtypes=''::oidvector AND f.prorettype='trigger'::regtype AND f.prosecdef
 WHEN 'character_production_planned_draft' THEN f.pronamespace='public'::regnamespace AND f.proargtypes='2950 3802 25 25'::oidvector AND f.prorettype='boolean'::regtype AND f.prosecdef
 WHEN 'character_production_new_blank_draft' THEN f.pronamespace='public'::regnamespace AND f.proargtypes='2950 3802 25 25'::oidvector AND f.prorettype='timestamptz'::regtype AND f.prosecdef
 WHEN 'character_production_plan' THEN f.pronamespace='public'::regnamespace AND f.proargtypes='3802 25 3802 2950 20 2950'::oidvector AND f.prorettype='jsonb'::regtype AND f.prosecdef
 WHEN 'character_production_planning_policy' THEN f.pronamespace='public'::regnamespace AND f.proargtypes='2950'::oidvector AND f.prorettype='jsonb'::regtype AND f.prosecdef
 ELSE false END) OR f.proowner<>expected_owner OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'Planner function identity mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))), e AS (SELECT expected_owner grantor,expected_owner grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT expected_owner,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Planner function ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p WHERE NOT EXISTS(SELECT 1 FROM pi_functions b WHERE b.oid=p.oid) AND p.pronamespace IN ('public'::regnamespace,'character_production'::regnamespace))<>6 THEN RAISE EXCEPTION 'Unexpected planner functions'; END IF;
 IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM pi_triggers b WHERE b.oid=t.oid))<>2 THEN RAISE EXCEPTION 'Unexpected planner triggers'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM pi_triggers b WHERE b.oid=t.oid) AND (t.tgtype<>27 OR t.tgenabled<>'O' OR t.tgqual IS NOT NULL OR t.tgnargs<>0 OR f.proowner<>own OR NOT ((t.tgname='planning_record_immutable' AND f.proname='planning_record_immutable' AND c.relname='planning_records') OR (t.tgname='planning_policy_revoke' AND f.proname='planning_policy_revoke' AND c.relname='planning_policies'))))) THEN RAISE EXCEPTION 'Planner trigger mismatch'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;
'''
print(pre+body(sources[0])+body(sources[1])+mid+body(sources[2])+post)
