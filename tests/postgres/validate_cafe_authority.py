#!/usr/bin/env python3
"""Fresh disposable PG17 only. Synthetic permissions, never production approvals."""
import json,hashlib,concurrent.futures
import validate_cafe_metricool as base
from validate_cafe_metricool import run,check,owner,q,fixture,ADMIN,ROOT

def canonical(v):return json.dumps(v,ensure_ascii=False,separators=(',',':'),sort_keys=True)
def sha(v):return hashlib.sha256(canonical(v).encode()).hexdigest()
def prepared(name):
 f=fixture('writer-'+name);s=f[3];p=f[0]
 owner('DELETE FROM cafe_metricool_private.approvals WHERE plan_id='+q(p))
 state=json.loads(owner('SELECT cafe_metricool_private.source_state('+q(p)+')'))
 clock=json.loads(run("SELECT json_build_object('now',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'expires',to_char((clock_timestamp()+interval '30 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))"))
 digest=sha(s);a={'reference':'synthetic-prior-owner-message','scheduleDigest':digest,'authorizedAt':clock['now'],'expiresAt':clock['expires'],'revoked':False}
 args=[p,s,digest,sha([s['brandId'],s['network'],s['accountId'],s['scheduledAt']]),sha([s['brandId'],s['network'],s['accountId'],s['videoSha256']]),state,ADMIN,clock['now'],clock['expires'],a]
 return args

def call(a):return 'public.cs_record_cafe_metricool_authority('+','.join(q(canonical(v))+'::jsonb' if isinstance(v,dict) else q(v) for v in a)+')'
def fail(a,label):
 try:owner('SELECT '+call(a))
 except AssertionError:pass
 else:raise AssertionError('accepted '+label)
 check('(SELECT count(*) FROM cafe_metricool_private.approvals WHERE plan_id='+q(a[0])+')=0','failed write fully rolled back '+label)
 check('(SELECT count(*) FROM cafe_metricool_private.owner_authority_provenance WHERE plan_id='+q(a[0])+')=0','no false provenance '+label)

def suite():
 base.suite()
 # Fixed boolean helper contract; installer ownership/membership tested separately.
 run("CREATE FUNCTION public.cs_cafe_metricool_is_admin(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT coalesce((SELECT raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb FROM auth.users WHERE id=p_user),false) $$; REVOKE ALL ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO metricool_owner;")
 sql=(ROOT/'docs/proposals/cafe-metricool-authority-writer.sql').read_text()
 owner(sql.replace('COMMIT;','ROLLBACK;'))
 check("to_regclass('cafe_metricool_private.owner_authority_provenance') IS NULL",'writer DDL rollback')
 owner(sql)
 for role in ['anon','authenticated','service_role']:
  check(f"NOT has_function_privilege({q(role)},'public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)','EXECUTE')",'no authority RPC grant')
 a=prepared('success');result=json.loads(owner('SELECT '+call(a)));assert result=={'digest':a[2],'expiresAt':a[8]}
 check('(SELECT count(*)=1 FROM cafe_metricool_private.owner_authority_provenance WHERE plan_id='+q(a[0])+')','provenance committed')
 try:owner('SELECT '+call(a))
 except AssertionError:pass
 else:raise AssertionError('duplicate authority insert permitted')
 check('(SELECT count(*)=1 FROM cafe_metricool_private.approvals WHERE plan_id='+q(a[0])+')','duplicate never overwrites')
 for name,change in [
 ('digest',lambda a:a.__setitem__(2,'0'*64)),('reservation',lambda a:a.__setitem__(3,'0'*64)),
 ('source',lambda a:a[5]['draft'].__setitem__('status','stale')),
 ('revoked',lambda a:a[9].__setitem__('revoked',True)),
 ('expiry',lambda a:a.__setitem__(8,'2000-01-01T00:00:00.000Z')),
 ('scope',lambda a:a[9].__setitem__('scheduleDigest','0'*64)),
 ('actor',lambda a:a.__setitem__(6,base.uid('not-admin'))),
 ('extra',lambda a:a[1].__setitem__('privateUrl','https://forbidden.invalid'))]:
  a=prepared(name);change(a);fail(a,name)
 a=prepared('standing');record=canonical({'policy':{'scope':'routine-cafe-persona-brand-promotions','revoked':False},'assessment':{'scheduleDigest':a[2],'classification':'routine-cafe-persona-brand-promotion','highImpact':False,'paidPromotion':False,'containsSensitivePersonalData':False}})
 a[9]['reference']='cafe-policy:'+hashlib.sha256(record.encode()).hexdigest();a[9]['evidenceRecord']=record
 assert json.loads(owner('SELECT '+call(a)))['digest']==a[2]
 check('(SELECT evidence_record='+q(record)+' FROM cafe_metricool_private.owner_authority_provenance WHERE plan_id='+q(a[0])+')','recoverable policy stored atomically')
 a=prepared('missing-policy-record');a[9]['reference']='cafe-policy:'+'a'*64;fail(a,'missing policy record')
 a=prepared('wrong-policy-hash');a[9]['reference']='cafe-policy:'+'a'*64;a[9]['evidenceRecord']=record;fail(a,'wrong policy hash')
 a=prepared('watermark');owner('DELETE FROM public.cs_character_promo_qa_checks WHERE promo_id='+q(a[1]['promoId'])+" AND check_name='third_party_watermark'")
 a[5]=json.loads(owner('SELECT cafe_metricool_private.source_state('+q(a[0])+')'));fail(a,'missing ninth QA')
 a=prepared('race')
 def write():
  try:return bool(owner('SELECT '+call(a)))
  except AssertionError:return False
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:write(),range(2)))
 assert sum(results)==1,results
 check('(SELECT count(*)=1 FROM cafe_metricool_private.owner_authority_provenance WHERE plan_id='+q(a[0])+')','concurrent insert exactly one')
 print('PASS: writer atomic rollback, exact digest, expiry, ninth QA, actor and concurrent insert')
if __name__=='__main__':
 try:suite()
 finally:
  (ROOT/'evidence').mkdir(exist_ok=True);(ROOT/'evidence/postgres-cafe-authority-validation.log').write_text('\n'.join(base.LOG))
