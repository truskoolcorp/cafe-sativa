#!/usr/bin/env python3
"""Disposable PG17 real planner/admin/writer chain. No provider calls or live data."""
import os,json,hashlib,subprocess,datetime,time,concurrent.futures
import validate_ledger as db
import validate_planner_install as foundation
import validate_planner as planner
from validate_enrolled_reads_install import verbatim_run
q=db.quote
j=lambda x:q(json.dumps(x))+'::jsonb'
E='22222222-2222-4222-8222-222222222222'
S='33333333-3333-4333-8333-333333333333'
P='44444444-4444-4444-8444-444444444444'
SIG='public.cs_record_enrolled_cafe_authority(uuid,jsonb,text,jsonb,jsonb)'
def fail(sql,label):
 p=subprocess.run(db.command(),input=sql,text=True,capture_output=True,timeout=30)
 db.LOG.append(p.stdout+p.stderr)
 assert p.returncode and label in p.stderr,(label,p.stdout,p.stderr)
def snapshot():
 return db.run("SELECT jsonb_build_object('approvals',(SELECT jsonb_agg(to_jsonb(a) ORDER BY plan_id) FROM cafe_metricool_private.approvals a),'standing',(SELECT jsonb_agg(to_jsonb(a) ORDER BY plan_id) FROM cafe_metricool_private.publication_authorities a),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY plan_id) FROM cafe_metricool_private.attempts a),'scope',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM cafe_metricool_private.publication_scopes a),'binding',(SELECT jsonb_agg(to_jsonb(a) ORDER BY name) FROM cafe_metricool_private.publication_binding a))")
def main():
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes' and os.environ.get('PGHOST') in ['localhost','127.0.0.1','::1']
 foundation.suite() # genuine distinct-auth-owner admin + recurring QA/wallet/planner installers
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+(db.ROOT/'docs/proposals/character-production-scheduler-principal.sql').read_text())
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 # Replace ONLY disposable foundation's old minimal Café guard scaffolding with
 # the actual store and writer. This is not a production installer migration.
 db.run("DROP SCHEMA cafe_metricool_private CASCADE; CREATE ROLE cafe_metricool_owner NOLOGIN NOSUPERUSER NOINHERIT; GRANT CREATE ON DATABASE character_ci_provision TO cafe_metricool_owner; GRANT CREATE ON SCHEMA public TO cafe_metricool_owner; GRANT USAGE ON SCHEMA auth TO cafe_metricool_owner; GRANT REFERENCES(id) ON auth.users TO cafe_metricool_owner; GRANT EXECUTE ON FUNCTION public.cs_cafe_metricool_is_admin(uuid) TO cafe_metricool_owner; ALTER TABLE public.cs_character_promo_delivery_plans ADD COLUMN caption text; ALTER TABLE public.cs_character_promo_qa_checks ADD COLUMN video_sha256 text,ADD COLUMN result text,ADD COLUMN reviewer_id uuid,ADD COLUMN evidence text,ADD COLUMN created_at timestamptz; GRANT UPDATE(id) ON public.cs_character_promo_drafts TO cafe_metricool_owner; GRANT SELECT,REFERENCES,TRIGGER ON public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks TO cafe_metricool_owner; CREATE POLICY standing_fixture_read_drafts ON public.cs_character_promo_drafts FOR SELECT TO cafe_metricool_owner USING(true); CREATE POLICY standing_fixture_read_plans ON public.cs_character_promo_delivery_plans FOR SELECT TO cafe_metricool_owner USING(true);")
 raw=(db.ROOT/'docs/proposals/cafe-metricool-store.sql').read_text()
 old="EXISTS(SELECT 1 FROM auth.users WHERE id=a.approved_by AND raw_app_meta_data->'cafe_sativa_admin'='true'::jsonb)"
 assert raw.count(old)==1
 raw=raw.replace(old,'public.cs_cafe_metricool_is_admin(a.approved_by)')
 db.run('SET ROLE cafe_metricool_owner; '+raw)
 db.run('SET ROLE cafe_metricool_owner; '+(db.ROOT/'docs/proposals/cafe-metricool-authority-writer.sql').read_text())
 db.run("SET ROLE cafe_metricool_owner; DO $$ DECLARE s text; BEGIN SELECT pg_get_functiondef('cafe_metricool_private.authorized(uuid,text)'::regprocedure) INTO s; EXECUTE replace(s,'(e.video_sha256=s->>''videoSha256'' OR','(e.evidence->>''promoId''=d.id::text OR e.video_sha256=s->>''videoSha256'' OR'); END $$;")
 db.run('REVOKE USAGE ON SCHEMA auth FROM cafe_metricool_owner;')
 auth_before=foundation.auth_snapshot() # baseline after disposable store FK scaffolding
 source=(db.ROOT/'docs/proposals/cafe-standing-publication-authority.sql').read_text()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner;')
 before=db.run("SELECT md5(prosrc) FROM pg_proc WHERE oid='cafe_metricool_private.authorized(uuid,text)'::regprocedure")
 assert before=='b851290417cceb49a25ab085e75f4765',before
 db.run(source.replace('\nCOMMIT;','\nROLLBACK;'))
 db.check("to_regclass('cafe_metricool_private.publication_scopes') IS NULL",'proposal rolls back')
 db.run(source)
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner,cafe_metricool_owner;')
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_function_privilege('+q(role)+','+q(SIG)+",'EXECUTE')",'no runtime grant in proposal')
  for table in ['publication_scopes','publication_binding','publication_authorities']:
   db.check('NOT has_table_privilege('+q(role)+','+q('cafe_metricool_private.'+table)+",'SELECT,INSERT,UPDATE,DELETE')",'no policy table access')
 db.check("NOT has_schema_privilege('cafe_metricool_owner','character_production','USAGE') AND NOT has_schema_privilege('cafe_metricool_owner','auth','USAGE')",'narrow bridge not raw access')
 # Synthetic scoped capability granted ONLY in disposable test; raw writer denied.
 db.run('GRANT EXECUTE ON FUNCTION '+SIG+' TO service_role; GRANT EXECUTE ON FUNCTION public.cs_claim_cafe_metricool(uuid,text,text,text),public.cs_preflight_cafe_metricool(uuid,text) TO service_role;')
 db.check("NOT has_function_privilege('service_role','public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)','EXECUTE')",'raw writer denied')
 slot,digest,plan=planner.fixture('standing-publication')
 plan['scheduledAt']=datetime.datetime.fromisoformat(plan['scheduledAt']).isoformat(timespec='milliseconds').replace('+00:00','Z')
 c=dict(ordinal=0,slot=slot,digest=digest,draftId=plan['draftId'],theme=plan['theme'],scheduledAt=plan['scheduledAt'])
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+q(slot['period'])+",2000,35,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000; INSERT INTO character_production.planning_policies VALUES('"+planner.POL+"',1,true,'{\"evidenceRef\":\"synthetic:standing-owner\"}',"+q(slot['period'])+",to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0),ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea'); INSERT INTO character_production.scheduler_enrollments SELECT '"+E+"',id,revision,'"+planner.ACT+"',to_jsonb(p),"+j([c])+",repeat('a',64),'synthetic:standing-owner',clock_timestamp()-interval '1 minute',expires_at,true FROM character_production.planning_policies p WHERE id='"+planner.POL+"'; INSERT INTO character_production.scheduler_candidates VALUES('"+E+"',0,"+j(slot)+","+q(digest)+",'"+plan['draftId']+"','"+plan['theme']+"',"+q(plan['scheduledAt'])+"); INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+E+"',true);")
 db.run("SET ROLE character_production_owner; SELECT public.character_production_scheduler_plan('"+E+"',0,"+j(plan['validation'])+");")
 sha=hashlib.sha256(b'synthetic-no-real-media').hexdigest();draft=plan['draftId'];path=f'character-promos/synthetic-persona/{draft}/{sha}.mp4'
 db.run("UPDATE public.cs_character_promo_drafts SET status='script_approved',actual_social_account='metricool-brand:7605217',video_asset_path="+q(path)+",voice_approved_at=now(),video_qa_approved_at=now(),publication_approved_at=now() WHERE id="+q(draft)+"; INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) VALUES('"+P+"',"+q(draft)+",'synthetic-persona','instagram','cafesativainc',"+q(plan['scheduledAt'])+",'ready_for_delivery','Synthetic routine'); INSERT INTO public.cs_character_promo_qa_checks(id,promo_id,check_name,video_sha256,result,reviewer_id,evidence,created_at) SELECT gen_random_uuid(),"+q(draft)+",n,"+q(sha)+",'pass','"+planner.ACT+"','Synthetic independent QA',now() FROM unnest(ARRAY['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark']) n;")
 clock=json.loads(db.run("SELECT jsonb_build_object('authorized',clock_timestamp()-interval '1 minute','expiry',to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0))"))
 policy=dict(version=1,reference='synthetic:owner-publication-policy',ownerMessageIds=['Sentinel_'+'a'*32],authorizedAt=clock['authorized'],validUntil=clock['expiry'],revoked=False,brandId='7605217',userId='4174093',accounts=[dict(network='facebook',accountId='105363501666032'),dict(network='instagram',accountId='cafesativainc')],characterIds=['synthetic-persona'],scope='routine-cafe-persona-brand-promotions',paidPromotion=False)
 db.run("INSERT INTO cafe_metricool_private.publication_scopes VALUES('"+S+"','"+E+"',repeat('a',64),'"+planner.ACT+"',"+j(policy)+",true); INSERT INTO cafe_metricool_private.publication_binding VALUES('cafe-routine-publication','"+S+"',true);")
 s=dict(version=1,planId=P,promoId=draft,characterId='synthetic-persona',brandId='7605217',userId='4174093',network='instagram',accountId='cafesativainc',timezone='America/Chicago',scheduledAt=plan['scheduledAt'],videoSha256=sha,videoPath=path,contentApprovalDigest='b'*64,caption='Synthetic routine',hashtags=[],collaborators=[])
 stable=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'))
 dig=hashlib.sha256(stable(s).encode()).hexdigest()
 state=db.run("SELECT cafe_metricool_private.source_state('"+P+"')")
 assessment="jsonb_build_object('scheduleDigest',"+q(dig)+",'assessedAt',clock_timestamp(),'evidenceRef','synthetic:semantic-review','classification','routine-cafe-persona-brand-promotion','highImpact',false,'paidPromotion',false,'containsSensitivePersonalData',false)"
 call="public.cs_record_enrolled_cafe_authority('"+P+"',"+j(s)+","+q(dig)+","+q(state)+"::jsonb,"+assessment+")"
 baseline=snapshot()
 for setup,label in [("UPDATE cafe_metricool_private.publication_binding SET enabled=false;",'Standing scope unavailable'),("UPDATE character_production.scheduler_binding SET enabled=false;",'Standing scope unavailable'),("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+planner.ACT+"';",'Standing scope unavailable'),("UPDATE character_production.planning_policies SET revision=2 WHERE id='"+planner.POL+"';",'Standing scope unavailable')]:
  fail('BEGIN; '+setup+' SET ROLE service_role; SELECT '+call+';',label);assert snapshot()==baseline
 # Owner-only staged variants in rolled-back transactions; runtime never edits policy.
 for field,value in [('paidPromotion',True),('brandId','foreign'),('characterIds',['another-persona']),('validUntil','2000-01-01T00:00:00Z'),('ownerMessageIds',[]),('revoked',True)]:
  bad=dict(policy);bad[field]=value
  mutation="INSERT INTO cafe_metricool_private.publication_scopes VALUES('66666666-6666-4666-8666-666666666666','"+E+"',repeat('a',64),'"+planner.ACT+"',"+j(bad)+",true); UPDATE cafe_metricool_private.publication_binding SET scope_id='66666666-6666-4666-8666-666666666666';"
  fail('BEGIN; '+mutation+' SET ROLE service_role; SELECT '+call+';','Standing scope unavailable');assert snapshot()==baseline
 for check in ['lip_sync','third_party_watermark']:
  fail("BEGIN; DELETE FROM public.cs_character_promo_qa_checks WHERE promo_id="+q(draft)+" AND check_name="+q(check)+"; SET ROLE service_role; SELECT "+call+';','Changed or already recorded source');assert snapshot()==baseline
 fail('SET ROLE service_role; SELECT '+call.replace(q(dig),q('f'*64),1)+';','Exact fresh semantic assessment required');assert snapshot()==baseline
 fail('SET ROLE service_role; SELECT '+call.replace("'routine-cafe-persona-brand-promotion'","'uncertain'")+';','Exact fresh semantic assessment required');assert snapshot()==baseline
 db.run('BEGIN; SET ROLE service_role; SELECT '+call+'; ROLLBACK;');assert snapshot()==baseline
 db.run('SET ROLE service_role; SELECT '+call+';')
 db.check("(SELECT count(*)=1 FROM cafe_metricool_private.publication_authorities) AND (SELECT count(*)=1 FROM cafe_metricool_private.approvals)",'single linked approval')
 fail('SET ROLE service_role; SELECT '+call+';','duplicate key')
 dest=hashlib.sha256(stable([s['brandId'],s['network'],s['accountId'],s['scheduledAt']]).encode()).hexdigest();media=hashlib.sha256(stable([s['brandId'],s['network'],s['accountId'],s['videoSha256']]).encode()).hexdigest()
 claim="public.cs_claim_cafe_metricool('"+P+"',"+q(dig)+","+q(dest)+","+q(media)+")"
 for mutation in ["UPDATE cafe_metricool_private.publication_binding SET enabled=false;","DELETE FROM cafe_metricool_private.publication_binding;","UPDATE character_production.scheduler_binding SET enabled=false;","UPDATE cafe_metricool_private.publication_scopes SET enabled=false WHERE id='"+S+"';"]:
  db.run('BEGIN; '+mutation+' SET ROLE service_role; DO $$ BEGIN IF '+claim+" IS NOT NULL THEN RAISE EXCEPTION 'queued revoked claim'; END IF; END $$; ROLLBACK;")
 # Retarget to distinct owner-created scope irreversibly disables old scope.
 db.run("BEGIN; INSERT INTO cafe_metricool_private.publication_scopes SELECT '55555555-5555-4555-8555-555555555555',enrollment_id,manifest_sha256,actor_id,policy,true FROM cafe_metricool_private.publication_scopes WHERE id='"+S+"'; UPDATE cafe_metricool_private.publication_binding SET scope_id='55555555-5555-4555-8555-555555555555'; SET ROLE service_role; DO $$ BEGIN IF "+claim+" IS NOT NULL THEN RAISE EXCEPTION 'retargeted old claim'; END IF; END $$; ROLLBACK;")
 # Deterministic NOWAIT contention and binding-retarget linearization.
 def leader(sql,follow,expected=None):
  proc=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  proc.stdin.write("SET application_name='standing_leader'; BEGIN; "+sql+" SELECT pg_sleep(3); ROLLBACK;\n");proc.stdin.close()
  try:
   for _ in range(100):
    if db.run("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='standing_leader' AND wait_event='PgSleep')")=='t':break
    if proc.poll() is not None:raise AssertionError(proc.stderr.read())
    time.sleep(.02)
   else:raise AssertionError('missing barrier')
   if expected:fail(follow,expected)
   else:db.run(follow)
   proc.wait(timeout=10);assert proc.returncode==0,proc.stderr.read()
  finally:
   if proc.poll() is None:proc.kill();proc.wait()
 leader("INSERT INTO cafe_metricool_private.publication_scopes SELECT '77777777-7777-4777-8777-777777777778',enrollment_id,manifest_sha256,actor_id,policy,true FROM cafe_metricool_private.publication_scopes WHERE id='"+S+"'; UPDATE cafe_metricool_private.publication_binding SET scope_id='77777777-7777-4777-8777-777777777778';",'SET ROLE service_role; SELECT '+claim+';','could not obtain lock')
 leader("UPDATE cafe_metricool_private.publication_binding SET enabled=false;",'SET ROLE service_role; SELECT '+claim+';','could not obtain lock')
 leader("UPDATE character_production.scheduler_binding SET enabled=false;",'SET ROLE service_role; SELECT '+claim+';','could not obtain lock')
 leader("SELECT 1 FROM character_production.planning_policies WHERE id='"+planner.POL+"' FOR UPDATE;",'SET ROLE service_role; SELECT '+claim+';','could not obtain lock')
 # Claim first holds scope/binding; a later retarget waits and commits only after
 # consumed authority linearizes. Test rolls back claim, then commits disable.
 leader('SET ROLE service_role; SELECT '+claim+';',"UPDATE cafe_metricool_private.publication_binding SET enabled=false;")
 db.check("NOT EXISTS(SELECT 1 FROM cafe_metricool_private.attempts)",'rolled back claim leaves no attempt')
 db.run('SET ROLE service_role; DO $$ BEGIN IF '+claim+" IS NOT NULL THEN RAISE EXCEPTION 'committed revoke ignored'; END IF; END $$;")
 assert foundation.auth_snapshot()==auth_before
 db.finish('cafe-standing-publication')
if __name__=='__main__':
 original=db.run
 db.run=verbatim_run
 try:main()
 finally:db.run=original
