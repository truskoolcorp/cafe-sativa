#!/usr/bin/env python3
"""Disposable four-capability grant; called after actual owner-only store/writer fixture."""
import pathlib,subprocess
import validate_cafe_metricool as m
R=pathlib.Path(__file__).resolve().parents[2]
def attempt(sql):
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=40)
 m.LOG.append(p.stdout+p.stderr);return p

def validate(prefix,snap):
 m.run("CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS; ALTER ROLE service_role NOLOGIN INHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION BYPASSRLS; CREATE ROLE capability_outsider NOLOGIN NOINHERIT; GRANT service_role TO authenticator WITH ADMIN FALSE,INHERIT FALSE,SET TRUE; GRANT service_role TO metricool_installer WITH ADMIN TRUE,INHERIT TRUE,SET TRUE;")
 m.run("CREATE ROLE supabase_admin NOLOGIN NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOBYPASSRLS; GRANT authenticator TO supabase_admin WITH ADMIN TRUE,INHERIT FALSE,SET FALSE; CREATE ROLE supabase_storage_admin LOGIN NOINHERIT NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS; ALTER ROLE supabase_storage_admin SET search_path='storage'; ALTER ROLE supabase_storage_admin SET log_statement='none'; GRANT authenticator TO supabase_storage_admin WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY supabase_admin;")
 source=(R/'docs/proposals/cafe-dispatch-capability-grant.sql').read_text()
 assert source==subprocess.check_output(['python3','scripts/prepare-cafe-dispatch-capability-grant.py'],cwd=R,text=True)
 sql=source.replace("'postgres'","'metricool_installer'").replace('TO postgres WITH','TO metricool_installer WITH').replace('BY postgres;','BY metricool_installer;').replace('FROM postgres GRANTED','FROM metricool_installer GRANTED')
 original_snap=snap
 def snap():
  return (original_snap(),m.run("SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r),'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d),'approvals',(SELECT jsonb_agg(to_jsonb(x) ORDER BY plan_id) FROM cafe_metricool_private.approvals x),'attempts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY plan_id) FROM cafe_metricool_private.attempts x),'provenance',(SELECT jsonb_agg(to_jsonb(x) ORDER BY plan_id) FROM cafe_metricool_private.owner_authority_provenance x),'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM cafe_metricool_private.external_receipts x))"))
 before=snap()
 for setup,label in [
 ('GRANT authenticator TO capability_outsider WITH INHERIT FALSE,SET TRUE;','Unexpected effective service principal'),
 ('GRANT service_role TO capability_outsider WITH INHERIT FALSE,SET TRUE;','Service role membership baseline mismatch'),
 ('GRANT supabase_storage_admin TO capability_outsider WITH INHERIT FALSE,SET TRUE;','Managed Storage membership baseline mismatch'),
 ('ALTER ROLE supabase_storage_admin INHERIT;','Managed Storage role baseline mismatch'),
 ('GRANT capability_outsider TO cafe_metricool_owner;','Unsafe ledger owner memberships'),
 ('GRANT EXECUTE ON FUNCTION public.cs_claim_cafe_metricool(uuid,text,text,text) TO service_role;','Dependency baseline ACL mismatch'),
 ('ALTER FUNCTION public.cs_claim_cafe_metricool(uuid,text,text,text) SECURITY INVOKER;','Dependency definition mismatch'),
 ("DO $$ BEGIN EXECUTE replace(pg_get_functiondef('cafe_metricool_private.authorized(uuid,text)'::regprocedure),'e.evidence->>''promoId''=d.id::text OR ',''); END $$;",'Dependency definition mismatch'),
 ('GRANT EXECUTE ON FUNCTION public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb) TO service_role;','Dependency baseline ACL mismatch')]:
  p=attempt('BEGIN; '+setup+prefix+sql);assert p.returncode and label in p.stderr,(label,p.stderr);assert snap()==before,label
 m.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'));assert snap()==before
 for broken,label in [(sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected capability abort'; END $$; COMMIT;"),'injected capability abort'),(sql.replace('TO service_role;','TO authenticated;'),'result ACL mismatch')]:
  p=attempt(prefix+broken);assert p.returncode and label in p.stderr,p.stderr;assert snap()==before
 m.run(prefix+sql)
 sigs=['cs_preflight_cafe_metricool(uuid,text)','cs_claim_cafe_metricool(uuid,text,text,text)','cs_identity_cafe_metricool(uuid,uuid,text,text)','cs_finish_cafe_metricool(uuid,uuid,text,jsonb)']
 for sig in sigs:
  m.check("has_function_privilege('service_role',"+m.q('public.'+sig)+",'EXECUTE')",'dispatch capability')
  for role in ['anon','authenticated','character_production_owner']:
   m.check('NOT has_function_privilege('+m.q(role)+','+m.q('public.'+sig)+",'EXECUTE')",'no unrelated grant')
 m.check("pg_has_role('supabase_storage_admin','service_role','SET') AND NOT pg_has_role('supabase_storage_admin','service_role','USAGE')",'Storage SET path disclosed')
 m.check("NOT pg_has_role('metricool_installer','cafe_metricool_owner','SET') AND NOT has_schema_privilege('service_role','cafe_metricool_private','USAGE')",'no private owner authority')
 p=attempt("SET ROLE service_role; SELECT public.cs_record_cafe_metricool_authority(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);")
 assert p.returncode and 'permission denied for function' in p.stderr,p.stderr
 m.run("SET ROLE service_role; DO $$ BEGIN IF public.cs_preflight_cafe_metricool('11111111-1111-4111-8111-111111111111','none') OR public.cs_claim_cafe_metricool('11111111-1111-4111-8111-111111111111','none','none','none') IS NOT NULL THEN RAISE EXCEPTION 'grant invented approval'; END IF; END $$;")
 p=attempt(prefix+sql);assert p.returncode and 'Dependency baseline ACL mismatch' in p.stderr,p.stderr
 m.LOG.append('PASS: dispatch-only capability, effective Storage path, writer denied and rollback')

if __name__=='__main__':
 import os
 import validate_cafe_metricool_install as installed
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes' and os.environ.get('PGHOST') in ['127.0.0.1','localhost','::1'] and os.environ.get('PGDATABASE')=='character_ci_metricool'
 os.environ['PGDATABASE']='character_ci_metricool_install'
 try:validate('SET SESSION AUTHORIZATION metricool_installer; ',installed.snap)
 finally:
  (R/'evidence').mkdir(exist_ok=True)
  (R/'evidence/postgres-cafe-dispatch-capability.log').write_text('\n'.join(m.LOG))
