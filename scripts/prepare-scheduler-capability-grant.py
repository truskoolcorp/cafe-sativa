#!/usr/bin/env python3
"""Emit offline exact three-wrapper EXECUTE delta; never connect or apply."""
from pathlib import Path
import hashlib,re
R=Path(__file__).resolve().parents[1]
s=(R/'docs/proposals/character-production-scheduler-principal.sql').read_text()
PIN='cec0ff48b82eedcbd342f13339457d561fb4abfc84dbe58bf05c106c59b49da5'
assert hashlib.sha256(s.encode()).hexdigest()==PIN
signatures=[('character_production_scheduler_context','uuid'),('character_production_scheduler_reconciled','uuid,integer'),('character_production_scheduler_plan','uuid,integer,jsonb')]
# Extract exact dollar-quoted body of every scoped wrapper from pinned proposal.
bodies={name:re.search(r'CREATE FUNCTION public\.'+name+r'\([^;]+?AS \$\$(.*?)\$\$;',s,re.S).group(1) for name,_ in signatures}
print("""-- OFFLINE REVIEW ONLY: no activation/enrollment. Three exact wrapper grants.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Direct reviewed PG17 source owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Restricted owner required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'Existing service role required'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected temporary authority'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option)<>1 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND grantor=current_user::regrole) THEN RAISE EXCEPTION 'Bootstrap membership mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member='character_production_owner'::regrole OR (roleid='character_production_owner'::regrole AND member<>current_user::regrole)) THEN RAISE EXCEPTION 'Unsafe ledger owner memberships'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND NOT rolcanlogin AND NOT rolsuper AND rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls) OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Service proxy role baseline mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member='service_role'::regrole) OR (SELECT count(*) FROM pg_auth_members WHERE roleid='service_role'::regrole)<>2 OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='service_role'::regrole AND NOT (m.grantor=(SELECT grantor FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member=current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option) AND ((m.member='authenticator'::regrole AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option) OR (m.member=current_user::regrole AND m.admin_option AND m.inherit_option AND m.set_option)))) THEN RAISE EXCEPTION 'Service role membership baseline mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.oid NOT IN (current_user::regrole,'service_role'::regrole,'authenticator'::regrole) AND (pg_has_role(r.oid,'service_role','USAGE') OR pg_has_role(r.oid,'service_role','SET'))) THEN RAISE EXCEPTION 'Unexpected effective service principal'; END IF;
END $$;
CREATE TEMP TABLE cg_expected(sig text PRIMARY KEY,body text) ON COMMIT DROP;""")
for name,args in signatures:
 sig='public.'+name+'('+args+')'
 print("INSERT INTO cg_expected VALUES('"+sig+"',$expected$"+bodies[name]+"$expected$);")
# Private scheduler implementations are authority, not merely wrapper plumbing.
print('CREATE TEMP TABLE cg_dependencies(sig text,body text,definer boolean) ON COMMIT DROP;')
for name,args,definer in [('scheduler_current','uuid',True),('scheduler_immutable','',False),('scheduler_binding_revoke','',True)]:
 body=re.search(r'CREATE FUNCTION character_production\.'+name+r'\([^;]+?AS \$\$(.*?)\$\$;',s,re.S).group(1)
 print("INSERT INTO cg_dependencies VALUES('character_production."+name+'('+args+")',$expected$"+body+'$expected$,'+str(definer).lower()+');')
print("""DO $$ DECLARE expected record; f record; own oid:='character_production_owner'::regrole; BEGIN
 FOR expected IN SELECT * FROM cg_dependencies LOOP
 -- Catalog lookup avoids asking source owner for private schema USAGE.
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='character_production' AND p.proname=split_part(split_part(expected.sig,'.',2),'(',1)
 AND p.proargtypes=CASE WHEN expected.sig LIKE '%scheduler_current%' THEN '2950'::oidvector ELSE ''::oidvector END;
 IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM expected.definer OR f.prosrc IS DISTINCT FROM expected.body OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prokind<>'f' OR f.provolatile<>'v' OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prorettype<>(CASE WHEN expected.sig LIKE '%scheduler_current%' THEN (SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='character_production' AND t.typname='scheduler_enrollments' AND t.typtype='c') ELSE 'trigger'::regtype END) THEN RAISE EXCEPTION 'Scoped dependency identity/body mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped dependency ACL mismatch'; END IF;
 END LOOP;
END $$;""")
print("""
DO $$ DECLARE expected record; f record; own oid:='character_production_owner'::regrole; BEGIN
 FOR expected IN SELECT * FROM cg_expected LOOP
 SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure(expected.sig);
 IF NOT FOUND OR f.proowner<>own OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM expected.body OR f.provolatile<>'v' OR f.prokind<>'f' OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prorettype<>(CASE WHEN expected.sig LIKE '%reconciled%' THEN 'boolean'::regtype ELSE 'jsonb'::regtype END) THEN RAISE EXCEPTION 'Scoped wrapper identity/body mismatch'; END IF;
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped wrapper baseline ACL mismatch'; END IF;
 END LOOP;
END $$;
CREATE TEMP TABLE cg_role_attributes ON COMMIT DROP AS SELECT * FROM pg_roles;
CREATE TEMP TABLE cg_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE cg_defaults ON COMMIT DROP AS SELECT * FROM pg_default_acl;
CREATE TEMP TABLE cg_namespaces ON COMMIT DROP AS SELECT oid,nspowner,nspacl FROM pg_namespace;
CREATE TEMP TABLE cg_tables ON COMMIT DROP AS SELECT oid,relowner,relacl,relrowsecurity,relforcerowsecurity FROM pg_class;
CREATE TEMP TABLE cg_columns ON COMMIT DROP AS SELECT attrelid,attnum,attacl FROM pg_attribute;
CREATE TEMP TABLE cg_policies ON COMMIT DROP AS SELECT oid,to_jsonb(p) data FROM pg_policy p;
CREATE TEMP TABLE cg_functions ON COMMIT DROP AS SELECT oid,proowner,proacl,pg_get_functiondef(oid) def FROM pg_proc WHERE prokind='f';
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
SET LOCAL ROLE character_production_owner;
CREATE TEMP TABLE cg_rows(name text,data jsonb) ON COMMIT DROP;
DO $$ DECLARE obj record; BEGIN
 FOR obj IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 EXECUTE format('LOCK TABLE character_production.%I IN SHARE MODE',obj.relname);
 EXECUTE format('INSERT INTO cg_rows SELECT %L,to_jsonb(r) FROM character_production.%I r',obj.relname,obj.relname);
 END LOOP;
END $$;
""")
for name,args in signatures: print('GRANT EXECUTE ON FUNCTION public.'+name+'('+args+') TO service_role;')
print("""
CREATE TEMP TABLE cg_after(name text,data jsonb) ON COMMIT DROP;
DO $$ DECLARE obj record; BEGIN
 FOR obj IN SELECT relname FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relkind='r' LOOP
 EXECUTE format('INSERT INTO cg_after SELECT %L,to_jsonb(r) FROM character_production.%I r',obj.relname,obj.relname);
 END LOOP;
 IF EXISTS((SELECT * FROM cg_rows EXCEPT ALL SELECT * FROM cg_after) UNION ALL (SELECT * FROM cg_after EXCEPT ALL SELECT * FROM cg_rows)) THEN RAISE EXCEPTION 'Ledger rows changed'; END IF;
END $$;
RESET ROLE;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
DO $$ DECLARE f record; own oid:='character_production_owner'::regrole; target oid:='service_role'::regrole; BEGIN
 IF EXISTS((SELECT * FROM pg_roles EXCEPT SELECT * FROM cg_role_attributes) UNION ALL (SELECT * FROM cg_role_attributes EXCEPT SELECT * FROM pg_roles)) THEN RAISE EXCEPTION 'Role attributes changed'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM cg_members) UNION ALL (SELECT * FROM cg_members EXCEPT SELECT * FROM pg_auth_members)) OR EXISTS((SELECT * FROM pg_default_acl EXCEPT SELECT * FROM cg_defaults) UNION ALL (SELECT * FROM cg_defaults EXCEPT SELECT * FROM pg_default_acl)) THEN RAISE EXCEPTION 'Membership/default ACL changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_namespaces b LEFT JOIN pg_namespace n USING(oid) WHERE n.oid IS NULL OR n.nspowner IS DISTINCT FROM b.nspowner OR n.nspacl IS DISTINCT FROM b.nspacl) OR EXISTS(SELECT 1 FROM cg_tables b LEFT JOIN pg_class c USING(oid) WHERE c.oid IS NULL OR c.relowner IS DISTINCT FROM b.relowner OR c.relacl IS DISTINCT FROM b.relacl OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity) OR EXISTS(SELECT 1 FROM cg_columns b LEFT JOIN pg_attribute a USING(attrelid,attnum) WHERE a.attrelid IS NULL OR a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing object authority changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_policies b LEFT JOIN pg_policy p USING(oid) WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_policy)<>(SELECT count(*) FROM cg_policies) THEN RAISE EXCEPTION 'Policies changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_functions b LEFT JOIN pg_proc p USING(oid) WHERE p.oid IS NULL OR p.proowner IS DISTINCT FROM b.proowner OR pg_get_functiondef(p.oid) IS DISTINCT FROM b.def OR (NOT EXISTS(SELECT 1 FROM cg_expected e WHERE to_regprocedure(e.sig)=p.oid) AND p.proacl IS DISTINCT FROM b.proacl)) THEN RAISE EXCEPTION 'Unrelated function changed'; END IF;
 FOR f IN SELECT p.* FROM pg_proc p JOIN cg_expected e ON p.oid=to_regprocedure(e.sig) LOOP
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,target,'EXECUTE',false) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped wrapper result ACL mismatch'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN cg_expected e WHERE NOT r.rolsuper AND r.oid NOT IN (current_user::regrole,'character_production_owner'::regrole,'service_role'::regrole,'authenticator'::regrole) AND has_function_privilege(r.oid,to_regprocedure(e.sig),'EXECUTE')) THEN RAISE EXCEPTION 'Unexpected effective wrapper grantee'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Temporary authority remains'; END IF;
END $$;
COMMIT;
""")
