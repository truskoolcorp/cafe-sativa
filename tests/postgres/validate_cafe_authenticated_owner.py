#!/usr/bin/env python3
"""Follow-on isolated PG17 test only, after store/writer/repair/dispatch fixtures."""
import os,pathlib,subprocess,json,hashlib
import validate_cafe_metricool as m
import validate_cafe_metricool_install as installed
R=pathlib.Path(__file__).resolve().parents[2]
OWNER='54b71f3f-19e1-46f0-99e2-28993463caf8'
canonical=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'))
sha=lambda v:hashlib.sha256(canonical(v).encode()).hexdigest()
def attempt(sql):
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=45);m.LOG.append(p.stdout+p.stderr);return p

def suite():
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes' and os.environ.get('PGHOST') in ['127.0.0.1','localhost','::1'] and os.environ.get('PGDATABASE')=='character_ci_metricool'
 os.environ['PGDATABASE']='character_ci_metricool_install'
 # Match provider claim extraction functions; no real JWTs/credentials. PostgREST
 # validates JWTs outside SQL, so this fixture models its role/claim context only.
 m.run("""CREATE ROLE supabase_auth_admin NOLOGIN NOSUPERUSER; CREATE ROLE dashboard_user NOLOGIN NOSUPERUSER;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;
 ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin; ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin; GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO dashboard_user;""")
 source=(R/'docs/proposals/cafe-authenticated-owner-authority.sql').read_text()
 sql=source.replace("'postgres'","'metricool_installer'").replace('TO postgres WITH','TO metricool_installer WITH').replace('BY postgres;','BY metricool_installer;').replace('FROM postgres GRANTED','FROM metricool_installer GRANTED').replace("to_regrole('supabase_admin')","to_regrole('postgres')")
 prefix='SET SESSION AUTHORIZATION metricool_installer; '
 before=installed.snap();m.run(prefix+sql.replace('\nCOMMIT;','\nROLLBACK;'));assert installed.snap()==before
 p=attempt(prefix+sql.replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected owner abort'; END $$; COMMIT;"));assert p.returncode and 'injected owner abort' in p.stderr;assert installed.snap()==before
 m.run(prefix+sql)
 m.run('INSERT INTO auth.users VALUES('+m.q(OWNER)+',\'{"cafe_sativa_admin":true}\');')
 def prepared(name):
  f=installed.fixture('auth-owner-'+name);s=f[3];m.run('DELETE FROM cafe_metricool_private.approvals WHERE plan_id='+m.q(f[0]))
  state=json.loads(m.run('SELECT cafe_metricool_private.source_state('+m.q(f[0])+')'))
  args=[f[0],s,sha(s),sha([s['brandId'],s['network'],s['accountId'],s['scheduledAt']]),sha([s['brandId'],s['network'],s['accountId'],s['videoSha256']]),state]
  call='public.cs_record_authenticated_cafe_authority('+','.join(m.q(canonical(x))+'::jsonb' if isinstance(x,dict) else m.q(x) for x in args)+",clock_timestamp()+interval '30 minutes')"
  return f,call
 def request(role,claims,call,extra=''):
  return 'SET ROLE '+role+'; SELECT set_config(\'request.jwt.claims\','+m.q(json.dumps(claims))+",false); "+extra+'SELECT '+call+';'
 for label,role,claims,extra in [
  ('valid','authenticated',{'role':'authenticated','sub':OWNER},''),
  ('service','service_role',{'role':'authenticated','sub':OWNER},''),
  ('serviceJWT','authenticated',{'role':'service_role','sub':OWNER},''),
  ('no-sub','authenticated',{'role':'authenticated'},''),
  ('other-admin','authenticated',{'role':'authenticated','sub':m.ADMIN},''),
  ('anon','anon',{'role':'authenticated','sub':OWNER},''),
  ('legacy-sub-mismatch','authenticated',{'role':'authenticated','sub':OWNER},"SELECT set_config('request.jwt.claim.sub',"+m.q(m.ADMIN)+",false); "),
 ]:
  f,call=prepared(label);p=attempt(request(role,claims,call,extra))
  if label=='valid':
   assert not p.returncode,p.stderr
   receipt=json.loads(p.stdout.splitlines()[-1]);assert receipt['digest']==sha(f[3])
   m.check('(SELECT approved_by='+m.q(OWNER)+' FROM cafe_metricool_private.approvals WHERE plan_id='+m.q(f[0])+')','derived exact owner')
   m.check('(SELECT reference='+m.q('authenticated-owner-preview:'+OWNER+':'+sha(f[3]))+' AND evidence_record IS NULL FROM cafe_metricool_private.owner_authority_provenance WHERE plan_id='+m.q(f[0])+')','no fabricated chat reference')
   again=attempt(request(role,claims,call));assert again.returncode,'no duplicate recording'
  else:
   assert p.returncode,(label,p.stdout)
   m.check('NOT EXISTS(SELECT 1 FROM cafe_metricool_private.approvals WHERE plan_id='+m.q(f[0])+')','denied request no approval')
 f,call=prepared('revoked-admin');m.run('UPDATE auth.users SET raw_app_meta_data=\'{"cafe_sativa_admin":false}\' WHERE id='+m.q(OWNER));p=attempt(request('authenticated',{'role':'authenticated','sub':OWNER},call));assert p.returncode
 m.check("NOT has_function_privilege('authenticated','public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)','EXECUTE') AND NOT has_schema_privilege('cafe_metricool_owner','auth','USAGE')",'no underlying writer/raw auth expansion')
 m.LOG.append('PASS: exact authenticated owner transport, role/claim/admin guards, fresh provenance and rollback');print(m.LOG[-1])
if __name__=='__main__':
 try:suite()
 finally:
  (R/'evidence').mkdir(exist_ok=True);(R/'evidence/postgres-cafe-authenticated-owner.log').write_text('\n'.join(m.LOG))
