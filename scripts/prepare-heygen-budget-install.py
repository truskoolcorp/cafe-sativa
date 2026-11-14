#!/usr/bin/env python3
"""Emit only existing-owner budget guard installer; no wallet/policy/budget rows."""
from pathlib import Path
import hashlib
R=Path(__file__).resolve().parents[1]
s=(R/'docs/proposals/character-production-heygen-budget.sql').read_text()
assert hashlib.sha256(s.encode()).hexdigest()=='7782fd1e7286b68619e80533b47e674b91a5c4166f545df0493ef1b12c429dc5'
s=s.split('\nBEGIN;',1)[1].rsplit('\nCOMMIT;',1)[0]
pre=r'''-- OFFLINE REVIEW ONLY. No budget ceiling change, evidence rows or activation.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Expected direct PG17 installer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe owner baseline'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected temporary authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Missing exact bootstrap membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence')) THEN RAISE EXCEPTION 'Existing budget guard requires reconciliation'; END IF;
END $$;
CREATE TEMP TABLE bi_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE bi_ns ON COMMIT DROP AS SELECT oid,nspacl,nspowner FROM pg_namespace WHERE nspname IN ('public','character_production');
CREATE TEMP TABLE bi_objects ON COMMIT DROP AS SELECT oid,relacl,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'character_production'::regnamespace);
CREATE TEMP TABLE bi_cols ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN (SELECT oid FROM bi_objects);
CREATE TEMP TABLE bi_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,prosecdef,proconfig,pg_get_functiondef(oid) def,(oid IN ('public.character_production_claim(jsonb,text)'::regprocedure,'public.character_production_due(text,text,integer)'::regprocedure,'public.character_production_observe_receipt(text,text,text,text)'::regprocedure)) replace_body FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace) AND prokind='f';
CREATE TEMP TABLE bi_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE bi_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
-- Existing ledger snapshots are read and compared under their unchanged owner.
CREATE TEMP TABLE bi_rows(name text,row jsonb) ON COMMIT DROP;
DO $$ DECLARE existing_table record; BEGIN
 FOR existing_table IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relkind='r' LOOP
 EXECUTE format('LOCK TABLE character_production.%I IN SHARE MODE',existing_table.relname);
 EXECUTE format('INSERT INTO bi_rows SELECT %L,to_jsonb(x) FROM character_production.%I x',existing_table.relname,existing_table.relname);
 END LOOP;
END $$;
'''
post=r'''
DO $$ DECLARE existing_table record; BEGIN
 IF EXISTS(SELECT 1 FROM character_production.heygen_wallet_policy) OR EXISTS(SELECT 1 FROM character_production.heygen_wallet_evidence) OR EXISTS(SELECT 1 FROM character_production.heygen_slot_evidence) THEN RAISE EXCEPTION 'Budget guard must install empty'; END IF;
 CREATE TEMP TABLE bi_rows_after(name text,row jsonb) ON COMMIT DROP;
 FOR existing_table IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relkind='r' AND c.relname NOT IN ('heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') LOOP
 EXECUTE format('INSERT INTO bi_rows_after SELECT %L,to_jsonb(x) FROM character_production.%I x',existing_table.relname,existing_table.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM bi_rows EXCEPT ALL SELECT * FROM bi_rows_after) UNION ALL (SELECT * FROM bi_rows_after EXCEPT ALL SELECT * FROM bi_rows)) THEN RAISE EXCEPTION 'Ledger data changed'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE new_object record; new_owner oid:='character_production_owner'::regrole; BEGIN
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM bi_members) UNION ALL (SELECT * FROM bi_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_ns b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspacl IS DISTINCT FROM b.nspacl OR n.nspowner IS DISTINCT FROM b.nspowner) THEN RAISE EXCEPTION 'Schema ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_objects b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM bi_cols b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR p.proacl IS DISTINCT FROM b.proacl OR p.prosecdef IS DISTINCT FROM b.prosecdef OR p.proconfig IS DISTINCT FROM b.proconfig OR (NOT b.replace_body AND pg_get_functiondef(p.oid) IS DISTINCT FROM b.def)) THEN RAISE EXCEPTION 'Existing function authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM bi_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM bi_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.data) THEN RAISE EXCEPTION 'Existing trigger changed'; END IF;
 FOR new_object IN SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') LOOP
 IF new_object.relkind<>'r' OR new_object.relowner<>new_owner OR NOT new_object.relrowsecurity OR new_object.relforcerowsecurity OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=new_object.oid AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'New budget table owner/RLS mismatch'; END IF;
 IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(new_object.relacl,acldefault('r',new_owner)))), expected AS (SELECT * FROM aclexplode(acldefault('r',new_owner))) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New budget table ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relname IN ('heygen_wallet_policy','heygen_wallet_evidence','heygen_slot_evidence') AND c.relkind='r')<>3 THEN RAISE EXCEPTION 'Missing budget table'; END IF;
 FOR new_object IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proname IN ('calendar_period','heygen_spend_allowed','heygen_evidence_immutable') LOOP
 IF NOT (CASE new_object.proname
 WHEN 'calendar_period' THEN new_object.proargtypes='25 1184'::oidvector AND new_object.prorettype='text'::regtype AND NOT new_object.prosecdef
 WHEN 'heygen_spend_allowed' THEN new_object.proargtypes='3802 25 20 25'::oidvector AND new_object.prorettype='boolean'::regtype AND new_object.prosecdef
 WHEN 'heygen_evidence_immutable' THEN new_object.proargtypes=''::oidvector AND new_object.prorettype='trigger'::regtype AND NOT new_object.prosecdef
 ELSE false END) THEN RAISE EXCEPTION 'New budget function signature/security mismatch'; END IF;
 IF new_object.proowner<>new_owner OR new_object.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'New budget function owner/config mismatch'; END IF;
 IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(new_object.proacl,acldefault('f',new_owner)))), expected AS (SELECT new_owner grantor,new_owner grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New budget function ACL mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='character_production' AND p.proname IN ('calendar_period','heygen_spend_allowed','heygen_evidence_immutable'))<>3 THEN RAISE EXCEPTION 'Missing budget function'; END IF;
 IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND NOT EXISTS(SELECT 1 FROM bi_triggers b WHERE b.oid=t.oid))<>1 OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgname='heygen_evidence_immutable' AND t.tgtype=27 AND t.tgenabled='O' AND t.tgqual IS NULL AND t.tgnargs=0 AND n.nspname='character_production' AND c.relname='heygen_wallet_evidence' AND p.proname='heygen_evidence_immutable' AND p.proowner=new_owner) THEN RAISE EXCEPTION 'New evidence trigger mismatch'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;
'''
print(pre+s+post)
