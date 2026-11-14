#!/usr/bin/env python3
"""Emit an inert existing-owner installation, never execute it."""
from pathlib import Path
import hashlib
R=Path(__file__).resolve().parents[1]
s=(R/'docs/proposals/character-production-qa-recurring.sql').read_text()
p=(R/'docs/proposals/character-production-qa-recurring-policies.sql').read_text()
assert hashlib.sha256(s.encode()).hexdigest()=='d821544acae19e6bf3a833e7aab7fed9e48ac0a6838218d495d2efb383933f3b'
assert hashlib.sha256(p.encode()).hexdigest()=='2ff733992cfc62d6b15bc6fa3f61387c7e883253769cf186a285126146e52690'
def body(x):return x.split('\nBEGIN;',1)[1].rsplit('\nCOMMIT;',1)[0]
s=body(s);p=body(p)
# Only these two reviewed authorization additions; source proposal left unchanged.
s=s.replace(' IF NOT FOUND OR d.updated_at IS DISTINCT FROM b.expected_updated_at',' IF NOT FOUND OR NOT public.character_production_qa_draft_unplanned(b.promo_id) OR d.updated_at IS DISTINCT FROM b.expected_updated_at')
s=s.replace(" WHERE j.state='pending_qa' AND d.updated_at=b.expected_updated_at", " WHERE j.state='pending_qa' AND public.character_production_qa_draft_unplanned(b.promo_id) AND d.updated_at=b.expected_updated_at")
s=s.replace('RETURN character_production.qa_manifest(p_key,p_digest) IS NOT NULL;', 'IF character_production.qa_manifest(p_key,p_digest) IS NULL THEN RETURN false; END IF;\n  RETURN public.character_production_qa_draft_unplanned(b.promo_id);')
assert s.count('public.character_production_qa_draft_unplanned(b.promo_id)')==3
pre=r'''-- OFFLINE REVIEW ONLY. Empty prebindings, no jobs, paid work, copy or activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct reviewed PG17 installer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe owner role or inherited membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='qa_slot_bindings') OR to_regprocedure('public.character_production_qa_draft_unplanned(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Recurring bridge already exists'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') OR has_column_privilege('character_production_owner','public.cs_character_promo_drafts','id','REFERENCES') THEN RAISE EXCEPTION 'Unexpected temporary-rights baseline'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing original bootstrap membership'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_drafts'::regclass AND relowner=current_user::regrole AND relrowsecurity AND NOT relforcerowsecurity) OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.cs_character_promo_delivery_plans'::regclass AND relowner=current_user::regrole AND NOT relforcerowsecurity) THEN RAISE EXCEPTION 'Unexpected source owner/RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.conrelid='public.cs_character_promo_delivery_plans'::regclass AND c.confrelid='public.cs_character_promo_drafts'::regclass AND c.convalidated AND NOT c.condeferrable AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='promo_id')] AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id')]) THEN RAISE EXCEPTION 'Required immediate plan/draft FK missing'; END IF;
 IF to_regprocedure('public.character_production_qa_prepare(text,text)') IS NULL OR to_regprocedure('public.character_production_qa_commit(text,text,text,bigint,uuid,timestamptz,text,text)') IS NULL THEN RAISE EXCEPTION 'Existing QA bridge required'; END IF;
END $$;
LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;
CREATE TEMP TABLE ri_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;
CREATE TEMP TABLE ri_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE ri_ns ON COMMIT DROP AS SELECT oid,nspacl FROM pg_namespace WHERE nspname IN ('public','character_production');
CREATE TEMP TABLE ri_objects ON COMMIT DROP AS SELECT oid,relowner,relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'character_production'::regnamespace);
CREATE TEMP TABLE ri_columns ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN ('public.cs_character_promo_drafts'::regclass,'public.cs_character_promo_delivery_plans'::regclass,'public.cs_character_promo_qa_checks'::regclass);
CREATE TEMP TABLE ri_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) AND prokind='f';
CREATE TEMP TABLE ri_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE ri_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t WHERE tgrelid IN ('public.cs_character_promo_drafts'::regclass,'public.cs_character_promo_delivery_plans'::regclass,'public.cs_character_promo_qa_checks'::regclass);
-- Owner-only boolean: no private ledger access and no source rows returned.
CREATE FUNCTION public.character_production_qa_draft_unplanned(p_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.cs_character_promo_drafts d WHERE d.id=p_id)
 AND NOT EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans p WHERE p.promo_id=p_id)
$$;
REVOKE ALL ON FUNCTION public.character_production_qa_draft_unplanned(uuid) FROM PUBLIC,anon,authenticated,service_role,character_production_generator,character_production_output_broker;
GRANT EXECUTE ON FUNCTION public.character_production_qa_draft_unplanned(uuid) TO character_production_owner;
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
GRANT REFERENCES(id) ON public.cs_character_promo_drafts TO character_production_owner;
SET LOCAL ROLE character_production_owner;
LOCK TABLE character_production.jobs,character_production.budgets,character_production.approved_slots,character_production.schedules,character_production.qa_targets,character_production.qa_ingestion_receipts IN SHARE MODE;
CREATE TEMP TABLE ri_ledger ON COMMIT DROP AS SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x UNION ALL SELECT 'targets',to_jsonb(x) FROM character_production.qa_targets x UNION ALL SELECT 'receipts',to_jsonb(x) FROM character_production.qa_ingestion_receipts x;
'''
post=r'''
GRANT EXECUTE ON FUNCTION public.character_production_qa_ready_slots(integer),public.character_production_qa_materialize(text,text) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM character_production.qa_slot_bindings) THEN RAISE EXCEPTION 'Bindings must install empty'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'jobs' name,to_jsonb(x) row FROM character_production.jobs x UNION ALL SELECT 'budgets',to_jsonb(x) FROM character_production.budgets x UNION ALL SELECT 'slots',to_jsonb(x) FROM character_production.approved_slots x UNION ALL SELECT 'schedules',to_jsonb(x) FROM character_production.schedules x UNION ALL SELECT 'targets',to_jsonb(x) FROM character_production.qa_targets x UNION ALL SELECT 'receipts',to_jsonb(x) FROM character_production.qa_ingestion_receipts x) (SELECT * FROM actual EXCEPT SELECT * FROM ri_ledger) UNION ALL (SELECT * FROM ri_ledger EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Ledger changed'; END IF;
END $$;
CREATE TEMP TABLE ri_usage(granted boolean NOT NULL) ON COMMIT DROP;
INSERT INTO ri_usage VALUES(NOT has_schema_privilege(session_user,'character_production','USAGE'));
DO $$ BEGIN IF (SELECT granted FROM ri_usage) THEN GRANT USAGE ON SCHEMA character_production TO postgres; END IF; END $$;
RESET ROLE;
'''
end=r'''
SET LOCAL ROLE character_production_owner;
DO $$ BEGIN IF (SELECT granted FROM ri_usage) THEN REVOKE USAGE ON SCHEMA character_production FROM postgres; END IF; END $$;
RESET ROLE;
REVOKE REFERENCES(id) ON public.cs_character_promo_drafts FROM character_production_owner;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE new_function_row record; new_binding_oid oid; owner_id oid:='character_production_owner'::regrole; BEGIN
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM ri_members) UNION ALL (SELECT * FROM ri_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_ns s LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM s.nspacl) THEN RAISE EXCEPTION 'Schema ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_objects o LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM o.relowner OR c.relacl IS DISTINCT FROM o.relacl OR c.relrowsecurity IS DISTINCT FROM o.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM o.relforcerowsecurity) THEN RAISE EXCEPTION 'Existing object changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_columns o LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM o.attacl) THEN RAISE EXCEPTION 'Column ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_functions f LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM f.proowner OR p.proacl IS DISTINCT FROM f.proacl OR pg_get_functiondef(p.oid) IS DISTINCT FROM f.def) THEN RAISE EXCEPTION 'Existing function changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_policies s LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM s.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*)+2 FROM ri_policies) THEN RAISE EXCEPTION 'Policy delta changed'; END IF;
 IF EXISTS(SELECT 1 FROM ri_triggers s LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM s.data) THEN RAISE EXCEPTION 'Existing trigger changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) row FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT SELECT * FROM ri_source) UNION ALL (SELECT * FROM ri_source EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source data changed'; END IF;

 SELECT c.oid INTO new_binding_oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname='qa_slot_bindings' AND c.relkind='r';
 IF new_binding_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=new_binding_oid AND relowner=owner_id AND relrowsecurity AND NOT relforcerowsecurity) OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=new_binding_oid) OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=new_binding_oid AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'New binding table ownership/RLS/column policy mismatch'; END IF;
 IF EXISTS(WITH actual AS (SELECT a.* FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=new_binding_oid), expected AS (SELECT * FROM aclexplode(acldefault('r',owner_id))) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New binding table ACL mismatch'; END IF;
 FOR new_function_row IN SELECT p.*, CASE WHEN p.proname='character_production_qa_draft_unplanned' THEN current_user::regrole::oid ELSE owner_id END expected_owner,
 CASE WHEN p.proname='character_production_qa_draft_unplanned' THEN owner_id WHEN p.proname IN ('character_production_qa_ready_slots','character_production_qa_materialize') THEN 'service_role'::regrole::oid ELSE NULL END extra_grantee
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='public' AND p.proname IN ('character_production_qa_draft_unplanned','character_production_qa_ready_slots','character_production_qa_materialize')) OR (n.nspname='character_production' AND p.proname='qa_binding_guard') LOOP
  IF new_function_row.proowner IS DISTINCT FROM new_function_row.expected_owner OR NOT new_function_row.prosecdef OR new_function_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'New function owner/config mismatch'; END IF;
  IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(new_function_row.proacl,acldefault('f',new_function_row.proowner)))), expected AS (SELECT new_function_row.expected_owner grantor,new_function_row.expected_owner grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT new_function_row.expected_owner,new_function_row.extra_grantee,'EXECUTE',false WHERE new_function_row.extra_grantee IS NOT NULL) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New function ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname IN ('character_production_qa_draft_unplanned','character_production_qa_ready_slots','character_production_qa_materialize')) OR (n.nspname='character_production' AND p.proname='qa_binding_guard'))<>4 THEN RAISE EXCEPTION 'New function identity count mismatch'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid=new_binding_oid AND NOT tgisinternal)<>1 OR NOT EXISTS(SELECT 1 FROM pg_trigger x JOIN pg_proc f ON f.oid=x.tgfoid WHERE x.tgrelid=new_binding_oid AND x.tgname='qa_binding_guard' AND x.tgtype=27 AND x.tgenabled='O' AND x.tgqual IS NULL AND x.tgnargs=0 AND f.proname='qa_binding_guard' AND f.proowner=owner_id AND f.pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='character_production')) THEN RAISE EXCEPTION 'New binding guard mismatch'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') OR has_column_privilege('character_production_owner','public.cs_character_promo_drafts','id','REFERENCES') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;
'''
print(pre+s+post+p+end)
