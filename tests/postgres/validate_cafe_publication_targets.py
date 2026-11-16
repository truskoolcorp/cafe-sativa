#!/usr/bin/env python3
"""Disposable PG17: real generation enrollment -> elapsed due -> QA -> future publication.
No provider/media generation or production data. Synthetic QA is fixture data only.
The predecessor setup is verbatim a27fb5c validate_cafe_standing_publication.py.
"""
import os,json,hashlib,datetime,subprocess
import validate_ledger as db
import validate_planner_install as foundation
import validate_planner as planner
from validate_enrolled_reads_install import verbatim_run
from validate_cafe_standing_publication import fail,E,S,P,SIG,q,j

def setup():
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

def main():
 setup()
 auth_before=foundation.auth_snapshot()
 source=(db.ROOT/'docs/proposals/cafe-publication-targets.sql').read_text()
 assert source.rstrip().endswith('ROLLBACK;')
 before_def=db.run("SELECT md5(prosrc) FROM pg_proc WHERE oid='cafe_metricool_private.publication_current(uuid,uuid)'::regprocedure")
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner,cafe_metricool_owner; '+source)
 db.check("to_regclass('cafe_metricool_private.publication_targets') IS NULL",'proposal rolls back')
 assert db.run("SELECT md5(prosrc) FROM pg_proc WHERE oid='cafe_metricool_private.publication_current(uuid,uuid)'::regprocedure")==before_def
 db.run(source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner,cafe_metricool_owner;')
 resolver_sig='public.cs_resolve_cafe_publication_target(uuid)'
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_function_privilege('+q(role)+','+q(resolver_sig)+",'EXECUTE')",'no resolver grant')
  for table in ['publication_cadences','publication_targets']:
   db.check('NOT has_table_privilege('+q(role)+','+q('cafe_metricool_private.'+table)+",'SELECT,INSERT,UPDATE,DELETE')",'no target/cadence grants')
 db.run('GRANT EXECUTE ON FUNCTION '+resolver_sig+' TO service_role;') # isolated test only
 slot,digest,plan=planner.fixture('publication-timing-generation')
 # Actual planner permits future generation, then time really elapses. Never
 # alter immutable provenance to manufacture a due slot.
 plan['scheduledAt']=db.run("SELECT to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
 c=dict(ordinal=0,slot=slot,digest=digest,draftId=plan['draftId'],theme=plan['theme'],scheduledAt=plan['scheduledAt'])
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+q(slot['period'])+",2000,35,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000; INSERT INTO character_production.planning_policies VALUES('"+planner.POL+"',1,true,'{\"evidenceRef\":\"synthetic:timing-owner\"}',"+q(slot['period'])+",to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0),ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea'); INSERT INTO character_production.scheduler_enrollments SELECT '"+E+"',id,revision,'"+planner.ACT+"',to_jsonb(p),"+j([c])+",repeat('a',64),'synthetic:timing-owner',clock_timestamp()-interval '1 minute',expires_at,true FROM character_production.planning_policies p WHERE id='"+planner.POL+"'; INSERT INTO character_production.scheduler_candidates VALUES('"+E+"',0,"+j(slot)+","+q(digest)+",'"+plan['draftId']+"','"+plan['theme']+"',"+q(plan['scheduledAt'])+"); INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+E+"',true);")
 planned=db.run("SET ROLE character_production_owner; SELECT public.character_production_scheduler_plan('"+E+"',0,"+j(plan['validation'])+");")
 assert planned, 'actual enrolled planner must create draft'
 draft=plan['draftId'];sha=hashlib.sha256(b'synthetic-no-real-media').hexdigest();path=f'character-promos/synthetic-persona/{draft}/{sha}.mp4'
 db.check("(SELECT scheduled_at>clock_timestamp() FROM character_production.planning_records WHERE promo_id="+q(draft)+")",'generation starts future')
 db.run("SELECT pg_sleep(greatest(0,extract(epoch FROM ("+q(plan['scheduledAt'])+"::timestamptz-clock_timestamp()))+.03))")
 db.check("(SELECT scheduled_at<clock_timestamp() FROM character_production.planning_records WHERE promo_id="+q(draft)+")",'generation due really elapsed before QA')
 paid=lambda:db.run("SELECT jsonb_build_object('jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.jobs j),'budgets',(SELECT jsonb_agg(to_jsonb(b) ORDER BY provider,period) FROM character_production.budgets b))")
 paid_before=paid()
 clock=json.loads(db.run("SELECT jsonb_build_object('authorized',clock_timestamp()-interval '1 minute','expiry',to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0))"))
 policy=dict(version=1,reference='synthetic:timing-policy',ownerMessageIds=['Sentinel_'+'a'*32],authorizedAt=clock['authorized'],validUntil=clock['expiry'],revoked=False,brandId='7605217',userId='4174093',accounts=[dict(network='facebook',accountId='105363501666032'),dict(network='instagram',accountId='cafesativainc')],characterIds=['synthetic-persona'],scope='routine-cafe-persona-brand-promotions',paidPromotion=False)
 db.run("INSERT INTO cafe_metricool_private.publication_scopes VALUES('"+S+"','"+E+"',repeat('a',64),'"+planner.ACT+"',"+j(policy)+",true); INSERT INTO cafe_metricool_private.publication_binding VALUES('cafe-routine-publication','"+S+"',true);")
 db.check("cafe_metricool_private.publication_schedule(public.cs_cafe_generation_membership("+q(draft)+"),"+q(draft)+",'"+S+"')="+q(plan['scheduledAt'])+"::timestamptz",'legacy no-cadence generation timing unchanged')
 db.run("INSERT INTO cafe_metricool_private.publication_cadences(scope_id,timezone,local_times,min_lead_seconds,max_horizon_seconds,enabled) VALUES('"+S+"','America/Chicago',ARRAY[((clock_timestamp()+interval '10 minutes') AT TIME ZONE 'America/Chicago')::time(0)],300,3600,true);")
 resolve="public.cs_resolve_cafe_publication_target("+q(draft)+")"
 def rpc(expression):return db.run('SET ROLE service_role; SELECT '+expression+';')
 def no_target(mutation=''):
  db.run("BEGIN; "+mutation+" SET ROLE service_role; DO $$ BEGIN IF "+resolve+" IS NOT NULL THEN RAISE EXCEPTION 'invalid target accepted'; END IF; END $$; ROLLBACK;")
 assert rpc(resolve)=='', 'no QA cannot select target'
 db.run("UPDATE public.cs_character_promo_drafts SET status='script_approved',actual_social_account='metricool-brand:7605217',video_asset_path="+q(path)+",voice_approved_at=clock_timestamp(),video_qa_approved_at=clock_timestamp(),publication_approved_at=clock_timestamp() WHERE id="+q(draft)+";")
 assert rpc(resolve)=='', 'approval stamps alone are not QA'
 db.run("INSERT INTO public.cs_character_promo_qa_checks(id,promo_id,check_name,video_sha256,result,reviewer_id,evidence,created_at) SELECT gen_random_uuid(),"+q(draft)+",n,"+q(sha)+",'pass','"+planner.ACT+"','Synthetic fixture QA after generation due',clock_timestamp() FROM unnest(ARRAY['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety','third_party_watermark']) n;")
 no_target("DELETE FROM public.cs_character_promo_qa_checks WHERE promo_id="+q(draft)+" AND check_name='third_party_watermark';")
 no_target("UPDATE public.cs_character_promo_qa_checks SET video_sha256=repeat('f',64) WHERE promo_id="+q(draft)+";")
 no_target("UPDATE public.cs_character_promo_qa_checks SET result='fail' WHERE promo_id="+q(draft)+" AND check_name='lip_sync';")
 no_target("UPDATE cafe_metricool_private.publication_binding SET enabled=false;")
 no_target("UPDATE character_production.scheduler_binding SET enabled=false;")
 no_target("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='"+planner.ACT+"';")
 # Existing delivery plans are not silently rescheduled.
 no_target("INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) VALUES('"+P+"',"+q(draft)+",'synthetic-persona','instagram','cafesativainc',"+q(plan['scheduledAt'])+",'ready_for_delivery','Legacy fixture');")
 db.run("BEGIN ISOLATION LEVEL REPEATABLE READ; SET ROLE service_role; DO $$ BEGIN IF "+resolve+" IS NOT NULL THEN RAISE EXCEPTION 'repeatable-read target accepted'; END IF; END $$; ROLLBACK;")
 # Staged target records test validation only and roll back. They do not assert
 # production history or bypass immutable-row triggers.
 target_insert="INSERT INTO cafe_metricool_private.publication_targets(promo_id,scope_id,enrollment_id,manifest_sha256,slot_digest,generation_due_at,publish_at,created_at) VALUES("+q(draft)+",'"+S+"','"+E+"',repeat('a',64),{digest},"+q(plan['scheduledAt'])+",{publish},"+q(plan['scheduledAt'])+"::timestamptz-interval '1 minute');"
 no_target(target_insert.format(digest=q('f'*64),publish="clock_timestamp()+interval '10 minutes'"))
 no_target(target_insert.format(digest=q(digest),publish=q(plan['scheduledAt'])+"::timestamptz+interval '.001 seconds'"))
 target=rpc(resolve)
 if not target:
  # Disposable-only diagnostic: retain every predicate, replace NULL exits by
  # numbered exceptions inside a transaction that always rolls back. Never
  # install this diagnostic function in production or bypass a failed guard.
  definition=db.run("SELECT pg_get_functiondef('public.cs_resolve_cafe_publication_target(uuid)'::regprocedure)")
  parts=definition.split('RETURN NULL;')
  diagnostic=parts[0]
  for index,part in enumerate(parts[1:],1):
   diagnostic+="RAISE EXCEPTION 'timing diagnostic guard "+str(index)+"';"+part
  result=subprocess.run(db.command(),input='BEGIN; '+diagnostic+' SET ROLE service_role; SELECT '+resolve+'; ROLLBACK;',text=True,capture_output=True)
  raise AssertionError('valid reviewed QA target unavailable: '+result.stderr)

 assert rpc(resolve)==target,'same immutable target on repeat'
 db.check("(SELECT publish_at>clock_timestamp()+interval '5 minutes' AND generation_due_at<clock_timestamp() FROM cafe_metricool_private.publication_targets WHERE promo_id="+q(draft)+")",'generation and publication clocks separated')
 assert json.loads(db.run("SELECT public.cs_cafe_generation_membership("+q(draft)+")"))['slotDigest']==digest
 db.check("(SELECT scheduled_at="+q(plan['scheduledAt'])+"::timestamptz FROM character_production.planning_records WHERE promo_id="+q(draft)+")",'original generation schedule untouched')
 fail("UPDATE cafe_metricool_private.publication_targets SET publish_at=publish_at+interval '1 hour';",'immutable')
 fail("UPDATE cafe_metricool_private.publication_cadences SET local_times=ARRAY['12:00'::time];",'immutable')
 target_iso=db.run("SELECT to_char("+q(target)+"::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
 db.run("INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) VALUES('"+P+"',"+q(draft)+",'synthetic-persona','instagram','cafesativainc',"+q(target_iso)+",'ready_for_delivery','Synthetic routine');")
 s=dict(version=1,planId=P,promoId=draft,characterId='synthetic-persona',brandId='7605217',userId='4174093',network='instagram',accountId='cafesativainc',timezone='America/Chicago',scheduledAt=target_iso,videoSha256=sha,videoPath=path,contentApprovalDigest='b'*64,caption='Synthetic routine',hashtags=[],collaborators=[])
 stable=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'))
 dig=hashlib.sha256(stable(s).encode()).hexdigest()
 state=db.run("SELECT cafe_metricool_private.source_state('"+P+"')")
 assessment="jsonb_build_object('scheduleDigest',"+q(dig)+",'assessedAt',clock_timestamp(),'evidenceRef','synthetic:semantic-review','classification','routine-cafe-persona-brand-promotion','highImpact',false,'paidPromotion',false,'containsSensitivePersonalData',false)"
 call="public.cs_record_enrolled_cafe_authority('"+P+"',"+j(s)+","+q(dig)+","+q(state)+"::jsonb,"+assessment+")"
 fail("BEGIN; UPDATE public.cs_character_promo_delivery_plans SET scheduled_at="+q(plan['scheduledAt'])+" WHERE id='"+P+"'; SET ROLE service_role; SELECT "+call+";",'Standing scope unavailable')
 rpc(call)
 db.check("(SELECT count(*)=1 FROM cafe_metricool_private.publication_authorities)",'real authority writer accepts resolved target')
 dest=hashlib.sha256(stable([s['brandId'],s['network'],s['accountId'],s['scheduledAt']]).encode()).hexdigest()
 media=hashlib.sha256(stable([s['brandId'],s['network'],s['accountId'],s['videoSha256']]).encode()).hexdigest()
 claim="public.cs_claim_cafe_metricool('"+P+"',"+q(dig)+","+q(dest)+","+q(media)+")"
 db.run("BEGIN; SET ROLE service_role; DO $$ BEGIN IF "+claim+" IS NULL THEN RAISE EXCEPTION 'future target claim rejected'; END IF; END $$; ROLLBACK;")
 for mutation in ["UPDATE cafe_metricool_private.publication_binding SET enabled=false;","UPDATE character_production.scheduler_binding SET enabled=false;"]:
  db.run("BEGIN; "+mutation+" SET ROLE service_role; DO $$ BEGIN IF "+claim+" IS NOT NULL THEN RAISE EXCEPTION 'revoked target claim accepted'; END IF; END $$; ROLLBACK;")
 assert paid()==paid_before,'target/authority timing never mutates generation jobs or budget'
 db.check("NOT EXISTS(SELECT 1 FROM cafe_metricool_private.attempts)",'claim rehearsal leaves no delivery attempt')
 assert foundation.auth_snapshot()==auth_before,'auth/default grants unchanged by timing lane'
 db.finish('cafe-publication-targets')

if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:main()
 finally:db.run=original

