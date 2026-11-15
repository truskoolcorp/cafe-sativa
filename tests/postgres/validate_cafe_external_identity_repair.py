#!/usr/bin/env python3
"""Disposable follow-on fixture after validate_cafe_metricool_install.py, no live."""
import os,pathlib,subprocess,json
import validate_cafe_metricool as m
import validate_cafe_metricool_install as installed
ROOT=pathlib.Path(__file__).resolve().parents[2]
def suite():
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes' and os.environ.get('PGHOST') in ['127.0.0.1','localhost','::1']
 assert os.environ.get('PGDATABASE')=='character_ci_metricool'
 os.environ['PGDATABASE']='character_ci_metricool_install'
 m.check("current_setting('server_version_num')::int BETWEEN 170000 AND 179999",'PG17')
 repair=(ROOT/'docs/proposals/cafe-metricool-external-identity-repair.sql').read_text()
 # Disposable installer is NOSUPERUSER with the genuine PG17 creator
 # ADMIN-only edge, granted by fixture postgres, not production supabase_admin.
 repair=repair.replace("'postgres'","'metricool_installer'").replace("'supabase_admin'","'postgres'").replace('TO postgres WITH','TO metricool_installer WITH').replace('BY postgres;','BY metricool_installer;').replace('FROM postgres GRANTED','FROM metricool_installer GRANTED')
 prefix='SET SESSION AUTHORIZATION metricool_installer; '
 def snapshot():
  return m.run("SELECT jsonb_build_object('function',(SELECT to_jsonb(p) FROM pg_proc p WHERE oid='cafe_metricool_private.authorized(uuid,text)'::regprocedure),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY provider_id,brand_id,network,account_id,video_sha256) FROM cafe_metricool_private.external_receipts r),'approvals',(SELECT jsonb_agg(to_jsonb(r) ORDER BY plan_id) FROM cafe_metricool_private.approvals r),'attempts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY plan_id) FROM cafe_metricool_private.attempts r),'members',(SELECT jsonb_agg(to_jsonb(r) ORDER BY roleid,member,grantor) FROM pg_auth_members r))")
 before=snapshot()
 m.run(prefix+repair.replace('\nCOMMIT;','\nROLLBACK;'))
 assert snapshot()==before,'rollback preserves rows definition ACL memberships'
 broken=repair.replace('\nCOMMIT;', "\nDO $$ BEGIN RAISE EXCEPTION 'injected repair abort'; END $$; COMMIT;")
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+broken,text=True,capture_output=True,timeout=40)
 assert p.returncode and 'injected repair abort' in p.stderr,p.stderr
 assert snapshot()==before,'injected abort restores exact pre-repair state'
 # Failure while restricted-owner SET is still active also restores the
 # self-issued grant; no capability leaks across aborted transactions.
 mid=repair.replace('RESET ROLE;', "DO $$ BEGIN RAISE EXCEPTION 'injected owner-stage abort'; END $$; RESET ROLE;")
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+mid,text=True,capture_output=True,timeout=40)
 assert p.returncode and 'injected owner-stage abort' in p.stderr,p.stderr
 assert snapshot()==before,'owner-stage failure restores bootstrap and source data'
 # Wrong runtime identity cannot repair or gain authority.
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input='SET ROLE service_role; '+repair,text=True,capture_output=True,timeout=40)
 assert p.returncode and 'Exact non-superuser source' in p.stderr,p.stderr
 assert snapshot()==before
 m.run(prefix+repair)
 m.check("(SELECT md5(prosrc)='b851290417cceb49a25ab085e75f4765' FROM pg_proc WHERE oid='cafe_metricool_private.authorized(uuid,text)'::regprocedure)",'exact repaired body')
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=prefix+repair,text=True,capture_output=True,timeout=40)
 assert p.returncode and 'Exact original authorized' in p.stderr,p.stderr
 def receipt(f,name,brand='7605217',network='instagram',account='cafesativainc',same_promo=True,same_sha=False):
  evidence=json.dumps({'promoId':f[1] if same_promo else m.uid('other-'+name)})
  m.run("INSERT INTO cafe_metricool_private.external_receipts VALUES("+','.join(m.q(x) for x in [name,brand,network,account,f[3]['videoSha256'] if same_sha else m.h('old-'+name),'2050-01-01T00:00:00Z'])+','+m.q(evidence)+'::jsonb);')
 for mode in ['identity','hash','unrelated','brand','network','account']:
  f=installed.fixture('external-repair-'+mode)
  receipt(f,mode,brand='other' if mode=='brand' else '7605217',network='facebook' if mode=='network' else 'instagram',account='other' if mode=='account' else 'cafesativainc',same_promo=mode not in ['hash','unrelated'],same_sha=mode=='hash')
  expected=mode not in ['identity','hash']
  m.check(f"public.cs_preflight_cafe_metricool({m.q(f[0])},{m.q(f[2])}) IS "+('TRUE' if expected else 'FALSE'),'exact scoped identity/hash suppression '+mode)
  if not expected:
   m.check(m.call(f)+' IS NULL','no claim '+mode)
   m.check(f"NOT EXISTS(SELECT 1 FROM cafe_metricool_private.attempts WHERE plan_id={m.q(f[0])})",'no fabricated attempt '+mode)
 m.LOG.append('PASS: exact owner negative-only identity repair, rollback, no grants, scoped identity/hash guards')
 print(m.LOG[-1])
if __name__=='__main__':
 try:suite()
 finally:
  (ROOT/'evidence').mkdir(exist_ok=True)
  (ROOT/'evidence/postgres-cafe-external-identity-repair.log').write_text('\n'.join(m.LOG))
