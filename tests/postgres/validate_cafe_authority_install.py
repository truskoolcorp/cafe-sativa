#!/usr/bin/env python3
"""Owner-only writer installation checks called by the disposable actual-store fixture."""
import pathlib,subprocess
import validate_cafe_metricool as m
ROOT=pathlib.Path(__file__).resolve().parents[2]
def validate(prefix,snap):
 source=(ROOT/'docs/proposals/cafe-metricool-authority-install.sql').read_text()
 generated=subprocess.check_output(['python3','scripts/prepare-cafe-metricool-authority-install.py'],cwd=ROOT,text=True)
 assert generated==source,'exact generated writer installer'
 source=source.replace("'postgres'","'metricool_installer'").replace('TO postgres WITH','TO metricool_installer WITH').replace('BY postgres;','BY metricool_installer;').replace('FROM postgres GRANTED','FROM metricool_installer GRANTED').replace("'supabase_admin'","'postgres'")
 before=snap()
 m.run(prefix+source.replace('\nCOMMIT;','\nROLLBACK;'))
 assert snap()==before,'writer rollback preserves full predecessor snapshot'
 cases=[('abort',source.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected writer abort'; END $$; COMMIT;"),'injected writer abort'),
 ('wrong body',source.replace('SELECT EXISTS(SELECT 1 FROM auth.users u','SELECT EXISTS(SELECT 2 FROM auth.users u',1),'Dependency definition/owner mismatch'),
 ('unknown function default',source.replace('SET LOCAL ROLE cafe_metricool_owner;','SET LOCAL ROLE cafe_metricool_owner; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO metricool_unexpected;'),'New function ACL mismatch'),
 ('unknown table default',source.replace('SET LOCAL ROLE cafe_metricool_owner;','SET LOCAL ROLE cafe_metricool_owner; ALTER DEFAULT PRIVILEGES IN SCHEMA cafe_metricool_private GRANT SELECT ON TABLES TO metricool_unexpected;'),'New table ACL mismatch')]
 for label,altered,error in cases:
  p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+altered,text=True,capture_output=True,timeout=55)
  m.LOG.append(label+': '+p.stdout+p.stderr)
  assert p.returncode and error in p.stderr,(label,p.stderr)
  assert snap()==before,label+' must rollback all existing objects'
  m.check("to_regclass('cafe_metricool_private.owner_authority_provenance') IS NULL AND to_regprocedure('public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)') IS NULL",'no partial writer objects')
 m.run(prefix+source)
 m.check("NOT pg_has_role('metricool_installer','cafe_metricool_owner','SET') AND NOT has_schema_privilege('cafe_metricool_owner','public','CREATE')",'writer installer temporary authority removed')
 m.check("(SELECT count(*)=0 FROM cafe_metricool_private.owner_authority_provenance)",'no writer records')
 for role in ['anon','authenticated','service_role','character_production_owner']:
  m.check(f"NOT has_function_privilege({m.q(role)},'public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)','EXECUTE')",'writer stays owner-only')
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+source,text=True,capture_output=True,timeout=55)
 assert p.returncode and 'Writer already exists: reconcile' in p.stderr,p.stderr
 m.LOG.append('PASS: actual-store owner-only writer install, rollback, exact dependencies and ACL rejection')
