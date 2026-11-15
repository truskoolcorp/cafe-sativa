#!/usr/bin/env python3
"""Generate owner-only writer installer from reviewed source and live dependency evidence. Never execute."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
src=(ROOT/'docs/proposals/cafe-metricool-authority-writer.sql').read_text()
assert hashlib.sha256(src.encode()).hexdigest()=='6852385f5523369c8df99657750555c73e4a0eee62f187b784959e89cb61d61f'
rows=json.loads((ROOT/'tests/sql/cafe-authority-installed-baseline.json').read_text())
assert len(rows)==8
q=lambda x:"'"+x.replace("'","''")+"'"
expected=','.join('('+','.join(map(q,[r['nspname'],r['proname'],r['definition'],r['owner']]))+')' for r in rows)
pre=r'''-- REVIEW ONLY. No runtime grants, approvals or provider operations.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact direct PG17 installer required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cafe_metricool_owner' AND NOT (rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Expected inert store owner'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole OR member='cafe_metricool_owner'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole AND member=current_user::regrole AND grantor=to_regrole('supabase_admin') AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'Unexpected store owner membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole='cafe_metricool_owner'::regrole) THEN RAISE EXCEPTION 'Unexpected owner defaults'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='cafe_metricool_private' AND nspowner='cafe_metricool_owner'::regrole) THEN RAISE EXCEPTION 'Expected installed store'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ('canonical_json','cs_record_cafe_metricool_authority') AND pronamespace IN ('public'::regnamespace,'cafe_metricool_private'::regnamespace)) OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='cafe_metricool_private'::regnamespace AND relname='owner_authority_provenance') THEN RAISE EXCEPTION 'Writer already exists: reconcile'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR has_schema_privilege('cafe_metricool_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected preexisting install authority'; END IF;
END $$;
CREATE TEMP TABLE cw_expected(nsp text,name text,definition text,owner_name text) ON COMMIT DROP;
'''+ 'INSERT INTO cw_expected VALUES '+expected+';\n'+r'''
DO $$ DECLARE e record; p record; BEGIN
 FOR e IN SELECT * FROM cw_expected LOOP
  IF (SELECT count(*) FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=e.nsp AND f.proname=e.name)<>1 THEN RAISE EXCEPTION 'Missing/overloaded dependency %',e.name; END IF;
  SELECT f.* INTO p FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname=e.nsp AND f.proname=e.name;
  IF pg_get_functiondef(p.oid) IS DISTINCT FROM e.definition OR p.proowner<>e.owner_name::regrole THEN RAISE EXCEPTION 'Dependency definition/owner mismatch %',e.name; END IF;
  IF e.name='cs_cafe_metricool_is_admin' THEN
   IF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))), expected AS (SELECT current_user::regrole::oid grantor,x::regrole::oid grantee,'EXECUTE'::text privilege_type,false is_grantable FROM unnest(ARRAY[current_user::text,'character_production_owner','cafe_metricool_owner']) x) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Bridge ACL mismatch'; END IF;
  ELSIF EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))), expected AS (SELECT p.proowner grantor,p.proowner grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'Dependency ACL mismatch %',e.name; END IF;
 END LOOP;
END $$;
CREATE TEMP TABLE cw_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc WHERE prokind='f' AND pronamespace IN ('public'::regnamespace,'cafe_metricool_private'::regnamespace);
CREATE TEMP TABLE cw_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE cw_roles ON COMMIT DROP AS SELECT oid,to_jsonb(r) data FROM pg_roles r;
CREATE TEMP TABLE cw_defaults ON COMMIT DROP AS SELECT oid,to_jsonb(d) data FROM pg_default_acl d;
CREATE TEMP TABLE cw_classes ON COMMIT DROP AS SELECT oid,to_jsonb(c) data FROM pg_class c WHERE relnamespace IN ('public'::regnamespace,'cafe_metricool_private'::regnamespace);
CREATE TEMP TABLE cw_columns ON COMMIT DROP AS SELECT attrelid,attnum,to_jsonb(a) data FROM pg_attribute a WHERE attrelid IN (SELECT oid FROM cw_classes);
CREATE TEMP TABLE cw_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE cw_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t WHERE tgrelid IN (SELECT oid FROM cw_classes);
CREATE TEMP TABLE cw_namespaces ON COMMIT DROP AS SELECT oid,nspowner,nspacl FROM pg_namespace WHERE nspname IN ('public','cafe_metricool_private');
GRANT cafe_metricool_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO cafe_metricool_owner;
SET LOCAL ROLE cafe_metricool_owner;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.approvals) OR EXISTS(SELECT 1 FROM cafe_metricool_private.attempts) OR (SELECT count(*) FROM cafe_metricool_private.external_receipts)<>22 THEN RAISE EXCEPTION 'Expected unchanged empty authority store'; END IF;
END $$;
CREATE TEMP TABLE cw_receipts ON COMMIT DROP AS SELECT * FROM cafe_metricool_private.external_receipts;
'''
body=src.split('\nBEGIN;',1)[1].rsplit('\nCOMMIT;',1)[0]
post=r'''
DO $$ DECLARE x record; own oid:='cafe_metricool_owner'::regrole; BEGIN
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.owner_authority_provenance) OR EXISTS(SELECT 1 FROM cafe_metricool_private.approvals) OR EXISTS(SELECT 1 FROM cafe_metricool_private.attempts) OR EXISTS((SELECT * FROM cw_receipts EXCEPT SELECT * FROM cafe_metricool_private.external_receipts) UNION ALL (SELECT * FROM cafe_metricool_private.external_receipts EXCEPT SELECT * FROM cw_receipts)) THEN RAISE EXCEPTION 'Store data changed'; END IF;
 SELECT * INTO x FROM pg_class WHERE oid='cafe_metricool_private.owner_authority_provenance'::regclass;
 IF x.relowner<>own OR x.relrowsecurity OR x.relforcerowsecurity OR EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(x.relacl,acldefault('r',own)))), expected AS (SELECT * FROM aclexplode(acldefault('r',own))) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New table ACL mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=x.oid AND attacl IS NOT NULL) OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=x.oid) THEN RAISE EXCEPTION 'Unexpected new table policy/column ACL'; END IF;
 FOR x IN SELECT * FROM pg_proc WHERE oid IN ('cafe_metricool_private.canonical_json(jsonb)'::regprocedure,'public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)'::regprocedure) LOOP
  IF x.proowner<>own OR EXISTS(WITH actual AS (SELECT * FROM aclexplode(coalesce(x.proacl,acldefault('f',own)))), expected AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) THEN RAISE EXCEPTION 'New function ACL mismatch'; END IF;
 END LOOP;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM cafe_metricool_owner;
REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE prokind='f' AND pronamespace IN ('public'::regnamespace,'cafe_metricool_private'::regnamespace))<>(SELECT count(*)+2 FROM cw_functions) THEN RAISE EXCEPTION 'Unexpected added function'; END IF;
 IF EXISTS(SELECT 1 FROM cw_functions b LEFT JOIN pg_proc p USING(oid) WHERE (b.proowner,b.proacl,b.definition) IS DISTINCT FROM (p.proowner,p.proacl,pg_get_functiondef(p.oid))) THEN RAISE EXCEPTION 'Existing functions changed'; END IF;
 IF EXISTS((SELECT * FROM cw_members EXCEPT SELECT * FROM pg_auth_members) UNION ALL (SELECT * FROM pg_auth_members EXCEPT SELECT * FROM cw_members)) THEN RAISE EXCEPTION 'Membership restoration mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM cw_roles b LEFT JOIN pg_roles r USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(r)) OR (SELECT count(*) FROM cw_roles)<>(SELECT count(*) FROM pg_roles) THEN RAISE EXCEPTION 'Roles changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_defaults b LEFT JOIN pg_default_acl d USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(d)) OR (SELECT count(*) FROM cw_defaults)<>(SELECT count(*) FROM pg_default_acl) THEN RAISE EXCEPTION 'Defaults changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_classes b LEFT JOIN pg_class c USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(c)) OR EXISTS(SELECT 1 FROM cw_columns b LEFT JOIN pg_attribute a ON a.attrelid=b.attrelid AND a.attnum=b.attnum WHERE b.data IS DISTINCT FROM to_jsonb(a)) THEN RAISE EXCEPTION 'Existing table/schema privileges changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_policies b LEFT JOIN pg_policy p USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(p)) OR (SELECT count(*) FROM cw_policies)<>(SELECT count(*) FROM pg_policy) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Existing triggers changed'; END IF;
 IF EXISTS(SELECT 1 FROM cw_namespaces b LEFT JOIN pg_namespace n USING(oid) WHERE (b.nspowner,b.nspacl) IS DISTINCT FROM (n.nspowner,n.nspacl)) THEN RAISE EXCEPTION 'Schema ACL restoration mismatch'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR has_schema_privilege('cafe_metricool_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary privilege leaked'; END IF;
END $$;
COMMIT;
'''
print(pre+body+post)
