#!/usr/bin/env python3
"""Disposable PG17 original bound text/QA/target/pair contract; synthetic provider/media only. Snapshot is deliberately minimal SQL-contract data,
not a full TypeScript verifyBindingSnapshot-approved image/audio proof."""
import os,json,hashlib
import validate_ledger as db
import validate_planner_install as foundation
import validate_planner as planner
from validate_enrolled_reads_install import verbatim_run
from validate_cafe_publication_targets import setup
from validate_cafe_standing_publication import fail,E,S,P,SIG,q,j
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
 for name in ['character-production-binding-snapshots.sql','character-production-replenishment.sql']:
  src=(db.ROOT/'docs/proposals'/name).read_text()
  db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 src=(db.ROOT/'docs/proposals/cafe-first-delivery-plans.sql').read_text()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner,cafe_metricool_owner; '+src)
 db.check("to_regclass('cafe_metricool_private.initial_editorial') IS NULL",'first delivery proposal rolls back')
 db.run(src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner,cafe_metricool_owner')
 signatures=['public.character_production_draft_editorial(uuid)','public.cs_prepare_cafe_delivery_plans(uuid)','public.cs_cafe_initial_editorial(uuid)']
 for role in ['anon','authenticated','service_role']:
  for sig in signatures:db.check('NOT has_function_privilege('+q(role)+','+q(sig)+",'EXECUTE')",'no runtime grant')
 db.check("NOT has_function_privilege('cafe_metricool_owner','public.character_production_draft_editorial(uuid)','EXECUTE')",'no cross-owner grant')
 db.check("NOT has_table_privilege('cafe_metricool_owner','public.cs_character_promo_delivery_plans','INSERT')",'no plan INSERT grant')
 # Explicit capabilities exclusively in disposable fixture, not in SQL proposal.
 db.run("GRANT EXECUTE ON FUNCTION public.character_production_draft_editorial(uuid) TO cafe_metricool_owner; GRANT INSERT(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) ON public.cs_character_promo_delivery_plans TO cafe_metricool_owner; CREATE POLICY first_delivery_insert_fixture ON public.cs_character_promo_delivery_plans FOR INSERT TO cafe_metricool_owner WITH CHECK(network IN('facebook','instagram')); GRANT EXECUTE ON FUNCTION public.cs_prepare_cafe_delivery_plans(uuid),public.cs_cafe_initial_editorial(uuid) TO service_role;")
 slot,digest,plan=planner.fixture('publication-timing-generation')
 # Actual planner permits future generation, then time really elapses. Never
 # alter immutable provenance to manufacture a due slot.
 plan['scheduledAt']=db.run("SELECT to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
 c=dict(ordinal=0,slot=slot,digest=digest,draftId=plan['draftId'],theme=plan['theme'],scheduledAt=plan['scheduledAt'])
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen',"+q(slot['period'])+",2000,35,true) ON CONFLICT(provider,period) DO UPDATE SET cap_cents=2000; INSERT INTO character_production.planning_policies VALUES('"+planner.POL+"',1,true,'{\"evidenceRef\":\"synthetic:timing-owner\"}',"+q(slot['period'])+",to_timestamp("+str(slot['authorizationExpiresAt'])+"/1000.0),ARRAY['synthetic-persona'],ARRAY['synthetic-theme'],31,45,2000,'d61468fdf18c4b478f27857337ddd1ea'); INSERT INTO character_production.scheduler_enrollments SELECT '"+E+"',id,revision,'"+planner.ACT+"',to_jsonb(p),"+j([c])+",repeat('a',64),'synthetic:timing-owner',clock_timestamp()-interval '1 minute',expires_at,true FROM character_production.planning_policies p WHERE id='"+planner.POL+"'; INSERT INTO character_production.scheduler_candidates VALUES('"+E+"',0,"+j(slot)+","+q(digest)+",'"+plan['draftId']+"','"+plan['theme']+"',"+q(plan['scheduledAt'])+"); INSERT INTO character_production.scheduler_binding VALUES('cafe-character-planner','"+E+"',true);")
 textkey='daily:2026-11-16:synthetic-persona';token='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';textdigest='e'*64
 editorial=dict(title='Synthetic gallery story',spokenScript=slot['script'],visualBrief='Synthetic approved scene',caption='Original stored caption',facebookTitle='Original stored Facebook title',hashtags=['CafeSativa'],collaborators=['dotproject2017'])
 src=dict(characterId=slot['characterId'],roomKey='gallery',canonicalRevision=slot['canonicalRevision'],voiceId=slot['voiceId'],portraitSha256=slot['portraitSha256'],verifiedHandles=['dotproject2017'])
 db.run("INSERT INTO character_production.text_replenishment_budgets VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',"+q(slot['period'])+",'claude-haiku-4-5-20251001',1,1,1,1,0,'synthetic-rate',clock_timestamp()+interval '1 hour',false); INSERT INTO character_production.text_replenishment_attempts(key,token,budget_id,source_snapshot,source_digest,state,output,provider_id,input_tokens,output_tokens) VALUES("+q(textkey)+','+q(token)+",'dddddddd-dddd-4ddd-8ddd-dddddddddddd',"+j(src)+','+q(textdigest)+",'claimed',NULL,NULL,NULL,NULL)")
 # Actual save function, synthetic provider result; no provider contacted.
 saved=db.run("SET ROLE character_production_owner; SELECT public.character_production_text_save("+q(textkey)+','+q(token)+','+q(textdigest)+','+j(editorial)+",'synthetic-provider-receipt',10,10)");assert saved=='t'
 snap=json.dumps(dict(version=1,account=dict(model='avatar_iv'),image=dict(characterId=slot['characterId'],canonicalRevision=slot['canonicalRevision'],portraitSha256=slot['portraitSha256'],audio=dict(voiceId=slot['voiceId'],scriptSha256=hashlib.sha256(slot['script'].encode()).hexdigest())),speech=dict(textAttemptKey=textkey,textAttemptToken=token,textSourceDigest=textdigest)),separators=(',',':'))
 plan['validation']['evidenceRef']='binding-snapshot-sha256:'+hashlib.sha256(snap.encode()).hexdigest()
 planned=db.run("SET ROLE character_production_owner; SELECT public.character_production_plan_bound("+j(slot)+','+q(digest)+','+j(plan)+','+q(planner.POL)+",1,"+q(planner.ACT)+','+q(snap)+")")
 assert planned, 'actual enrolled planner must create draft'
 draft=plan['draftId']
 # The old fixture could SELECT but silently could not lock the same row.
 db.run("BEGIN; SET ROLE cafe_metricool_owner; DO $$ BEGIN PERFORM 1 FROM public.cs_character_promo_drafts WHERE id="+q(draft)+"; IF NOT FOUND THEN RAISE EXCEPTION 'fixture draft must be SELECT-visible'; END IF; PERFORM 1 FROM public.cs_character_promo_drafts WHERE id="+q(draft)+" FOR UPDATE; IF FOUND THEN RAISE EXCEPTION 'missing lock policy unexpectedly permitted lock'; END IF; END $$; ROLLBACK;")
 db.run("CREATE POLICY cafe_metricool_owner_lock ON public.cs_character_promo_drafts FOR UPDATE TO cafe_metricool_owner USING(true) WITH CHECK(false);")
 db.run("BEGIN; SET ROLE cafe_metricool_owner; DO $$ BEGIN PERFORM 1 FROM public.cs_character_promo_drafts WHERE id="+q(draft)+" FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'existing draft lock policy must expose row'; END IF; END $$; ROLLBACK;")
 fail("BEGIN; SET ROLE cafe_metricool_owner; UPDATE public.cs_character_promo_drafts SET id=id WHERE id="+q(draft)+";",'row-level security')
 sha=hashlib.sha256(b'synthetic-no-real-media').hexdigest();path=f'character-promos/synthetic-persona/{draft}/{sha}.mp4'
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
 prepare="public.cs_prepare_cafe_delivery_plans("+q(draft)+")"
 def deny(mutation):
  db.run("BEGIN; "+mutation+" SET ROLE service_role; DO $$ BEGIN IF "+prepare+" IS NOT NULL THEN RAISE EXCEPTION 'invalid first delivery accepted'; END IF; END $$; ROLLBACK;")
  db.check("NOT EXISTS(SELECT 1 FROM cafe_metricool_private.initial_editorial) AND NOT EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans WHERE promo_id="+q(draft)+")",'denied preparation leaves no pair')
 deny("UPDATE character_production.text_replenishment_attempts SET source_digest=repeat('f',64);")
 deny("UPDATE character_production.text_replenishment_attempts SET output=jsonb_set(output,'{spokenScript}','\"Different script\"');")
 deny("UPDATE character_production.text_replenishment_attempts SET output=jsonb_set(output,'{collaborators}','[\"unverified\"]');")
 deny("DELETE FROM public.cs_character_promo_qa_checks WHERE check_name='third_party_watermark';")
 deny("UPDATE cafe_metricool_private.publication_binding SET enabled=false;")
 deny("INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,account_id,scheduled_at,status,caption) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',"+q(draft)+",'synthetic-persona','instagram','cafesativainc',clock_timestamp(),'ready_for_delivery','Legacy untouched');")
 db.run('BEGIN; SET ROLE service_role; SELECT '+prepare+'; ROLLBACK;')
 db.check("NOT EXISTS(SELECT 1 FROM cafe_metricool_private.initial_editorial) AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.publication_targets)",'target and pair rollback together')
 # Force failure after both INSERTs: whole statement must roll back target+pair.
 db.run("ALTER TABLE cafe_metricool_private.initial_editorial ADD CONSTRAINT fixture_reject_evidence CHECK(false) NOT VALID")
 fail('SET ROLE service_role; SELECT '+prepare, 'fixture_reject_evidence')
 db.check("NOT EXISTS(SELECT 1 FROM cafe_metricool_private.initial_editorial) AND NOT EXISTS(SELECT 1 FROM cafe_metricool_private.publication_targets) AND NOT EXISTS(SELECT 1 FROM public.cs_character_promo_delivery_plans WHERE promo_id="+q(draft)+")",'post-pair failure leaves no partial writes')
 db.run("ALTER TABLE cafe_metricool_private.initial_editorial DROP CONSTRAINT fixture_reject_evidence")
 first=json.loads(rpc(prepare));assert first['created'] is True
 again=json.loads(rpc(prepare));assert again['created'] is False and first['facebookPlanId']==again['facebookPlanId'] and first['instagramPlanId']==again['instagramPlanId']
 for name,network in [('facebookPlanId','facebook'),('instagramPlanId','instagram')]:
  got=json.loads(rpc('public.cs_cafe_initial_editorial('+q(first[name])+')'))
  assert got['network']==network and got['evidence']['editorial']==editorial
  assert got['evidence']['characterId']==slot['characterId'] and got['evidence']['roomKey']=='gallery'
  assert got['plan']['id']==first[name] and got['plan']['promo_id']==draft and got['plan']['network']==network and got['plan']['caption']==editorial['caption']
  assert got['draft']['id']==draft and got['draft']['spoken_script']==slot['script'] and got['draft']['video_asset_path']==path
  db.check("(SELECT caption='Original stored caption' FROM public.cs_character_promo_delivery_plans WHERE id="+q(first[name])+")",'caption copied exactly from saved text')
 assert rpc("public.cs_prepare_cafe_delivery_plans('5094636c-be48-4ac3-ae7b-80acfb729c13')")=='','old intro not regenerated'
 fail("UPDATE cafe_metricool_private.initial_editorial SET evidence='{}';",'immutable')
 assert paid()==paid_before,'first delivery cannot generate or spend'
 db.finish('cafe-first-delivery')
if __name__=='__main__':
 original=db.run;db.run=verbatim_run
 try:main()
 finally:db.run=original
