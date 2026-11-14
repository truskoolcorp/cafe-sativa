#!/usr/bin/env python3
"""Disposable PG17 existing-owner QA install/enrollment; never storage/provider calls."""
import os,subprocess,json,re
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db
import validate_provisioning as provision
import validate_backend_grants as backend
KEY='zaria-gallery-image-canary-20261114';DIGEST='01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3';SHA='018615557e88f67a26ee97136376bfdde215fe2cd2ca6e274c6d48825c116658';PID='7edd4058-9184-4411-9a95-bad175e974ea';OLD='11111111-1111-4111-8111-111111111111'
def prepare():return 'public.character_production_qa_prepare('+db.quote(KEY)+','+db.quote(DIGEST)+')'
def commit(sha=SHA,path=None):
 return 'public.character_production_qa_commit('+','.join([db.quote(KEY),db.quote(DIGEST),db.quote(sha),'4023955',db.quote(PID)+'::uuid',"(m->>'expectedUpdatedAt')::timestamptz","'cafe-sativa-content'",db.quote(path) if path else "m->>'destinationPath'"])+')'
def adapt(s):return s.replace("'postgres'","'provision_installer'").replace('TO postgres WITH','TO provision_installer WITH').replace('BY postgres;','BY provision_installer;').replace('FROM postgres GRANTED','FROM provision_installer GRANTED').replace('TO postgres;','TO provision_installer;').replace('FROM postgres;','FROM provision_installer;')
def snapshot():
 return db.run("SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),'funcs',(SELECT jsonb_agg(jsonb_build_array(oid,proowner,proacl::text,pg_get_functiondef(oid)) ORDER BY oid) FROM pg_proc WHERE (pronamespace='character_production'::regnamespace OR pronamespace='public'::regnamespace) AND prokind='f'),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p),'source',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.cs_character_promo_drafts d),'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.jobs j),'slots',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.approved_slots j),'budgets',(SELECT jsonb_agg(to_jsonb(j) ORDER BY provider,period) FROM character_production.budgets j),'schedules',(SELECT jsonb_agg(to_jsonb(j) ORDER BY key) FROM character_production.schedules j),'acls',(SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl::text,relrowsecurity) ORDER BY oid) FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'character_production'::regnamespace)),'cols',(SELECT jsonb_agg(jsonb_build_array(attrelid,attnum,attacl::text) ORDER BY attrelid,attnum) FROM pg_attribute WHERE attrelid='public.cs_character_promo_drafts'::regclass))")
def service_assert(expr,label):db.run('SET SESSION AUTHORIZATION service_role; DO $$ BEGIN IF ('+expr+') IS DISTINCT FROM true THEN RAISE EXCEPTION '+db.quote(label)+'; END IF; END $$;')
def suite():
 db.command();db.run('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
 provision.suite();backend.suite();os.environ['PGDATABASE']='character_ci_provision'
 prefix='SET SESSION AUTHORIZATION provision_installer; '
 db.run(prefix+(db.ROOT/'supabase/migrations/20261020154000_character_canon_spoken_promos.sql').read_text())
 db.run(prefix+"CREATE TABLE public.cs_character_promo_qa_checks(id uuid PRIMARY KEY,promo_id uuid,check_name text); CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean,file_size_limit bigint,allowed_mime_types text[]); INSERT INTO storage.buckets VALUES('cafe-sativa-content',false,52428800,ARRAY['video/mp4']); GRANT SELECT(id),UPDATE(status) ON public.cs_character_promo_drafts TO service_role;")
 # Captured legacy guard body and synthetic dependencies, retained unchanged.
 db.run(prefix+"CREATE SCHEMA cs_promo_private; CREATE TABLE cs_promo_private.gates(plan_id uuid,generation_id uuid,gate text,confirmed_at timestamptz,draft_applied boolean DEFAULT false,plan_applied boolean DEFAULT false,invalidated boolean DEFAULT false); CREATE TABLE cs_promo_private.attempts(plan_id uuid); CREATE TABLE cs_promo_private.approvals(plan_id uuid,invalidated boolean DEFAULT false); CREATE TABLE cs_promo_private.review_heads(generation_id uuid); CREATE TABLE cs_promo_private.review_versions(plan_id uuid,invalidated boolean DEFAULT false); "+(db.ROOT/'tests/fixtures/character-production-draft-guard.sql').read_text()+"; CREATE TRIGGER cs_promo_draft_guard BEFORE UPDATE OR DELETE ON public.cs_character_promo_drafts FOR EACH ROW EXECUTE FUNCTION cs_promo_private.guard_source();")
 # Exact Cafe guard logic as deployed store proposal, synthetic private attempts.
 cafe=(db.ROOT/'tests/fixtures/cafe-metricool-draft-guard.sql').read_text()
 db.run(prefix+"CREATE SCHEMA cafe_metricool_private; CREATE TABLE cafe_metricool_private.attempts(plan_id uuid); "+cafe+" CREATE TRIGGER cafe_metricool_draft_guard BEFORE UPDATE OR DELETE ON public.cs_character_promo_drafts FOR EACH ROW EXECUTE FUNCTION cafe_metricool_private.guard_source();")
 db.run(prefix+"INSERT INTO public.cs_character_promo_drafts(id,character_id,promo_key,specialty,title,spoken_script,visual_brief,duration_seconds) VALUES('"+OLD+"','unbound','unbound-prior','Unbound','Prior preserved draft','Prior script','Prior visual',8);")
 enrollment=(db.ROOT/'docs/proposals/character-production-qa-enroll-zaria.sql').read_text();slot=json.loads(re.search(r'\$slot\$(.*?)\$slot\$',enrollment,re.S).group(1))
 db.run("INSERT INTO character_production.budgets(provider,period,cap_cents,reserved_cents,enabled) VALUES('heygen','2026-11',40,35,true); INSERT INTO character_production.approved_slots(key,slot,digest,enabled) VALUES("+db.quote(KEY)+','+db.quote(json.dumps(slot))+"::jsonb,"+db.quote(DIGEST)+",true); INSERT INTO character_production.jobs(key,slot,digest,provider,model,period,provider_binding_revision,cost,state,task,sha,bytes,bucket,object_path) SELECT key,slot,digest,'heygen','avatar_iv','2026-11',slot->>'providerBindingRevision',35,'pending_qa','c8246007ce21cee14e38f409b4492967',"+db.quote(SHA)+",4023955,'character-production-private',digest||'/"+SHA+".mp4' FROM character_production.approved_slots WHERE key="+db.quote(KEY)+"; INSERT INTO character_production.schedules VALUES("+db.quote(KEY)+','+db.quote(DIGEST)+",'2026-11-14T17:35:00Z','2026-11-14T18:25:00Z',false);")
 install=(db.ROOT/'docs/proposals/character-production-qa-install.sql').read_text();assert install==subprocess.check_output(['python3','scripts/prepare-qa-bridge-install.py'],cwd=db.ROOT,text=True)
 before=snapshot();db.run(prefix+adapt(install).replace('\nCOMMIT;','\nROLLBACK;'));assert snapshot()==before,'install rollback exact'
 broken=adapt(install).replace('\nCOMMIT;',"\nDO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$; COMMIT;")
 p=subprocess.run(db.command(),input=prefix+broken,text=True,capture_output=True,timeout=40);assert p.returncode and 'injected abort' in p.stderr,p.stderr;assert snapshot()==before,'failed installer exact rollback'
 db.run(prefix+adapt(install));installed=snapshot()
 db.check("NOT pg_has_role('provision_installer','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'no installer authority remains')
 db.check("NOT has_schema_privilege('provision_installer','character_production','USAGE')",'temporary namespace resolution removed')
 db.run('SET ROLE character_production_owner; DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.cs_character_promo_drafts) THEN RAISE EXCEPTION \'unbound draft visible\'; END IF; END $$;')
 db.run("SET ROLE character_production_owner; UPDATE public.cs_character_promo_drafts SET video_asset_path='not-allowed',updated_at=now() WHERE id='"+OLD+"';")
 db.check("(SELECT video_asset_path IS NULL FROM public.cs_character_promo_drafts WHERE id='"+OLD+"')",'unbound update invisible')
 db.run(prefix+adapt(enrollment).replace('\nCOMMIT;','\nROLLBACK;'));assert snapshot()==installed,'enrollment rollback exact'
 db.run(prefix+adapt(enrollment))
 db.check("(SELECT character_id='zaria-solenne' AND status='draft' AND duration_seconds=8 AND evidence->>'recovery'='manual_original_output_recovery' AND video_asset_path IS NULL AND audio_asset_path IS NULL AND voice_approved_at IS NULL AND video_qa_approved_at IS NULL AND publication_approved_at IS NULL FROM public.cs_character_promo_drafts WHERE id='"+PID+"')",'exact unapproved manual recovery candidate')
 p=subprocess.run(db.command(),input=prefix+adapt(enrollment),text=True,capture_output=True,timeout=40);assert p.returncode and 'Candidate already exists' in p.stderr
 service_assert(prepare()+"->>'state'='copy'",'backend prepare exact target')
 for role in ['anon','authenticated','character_production_generator','character_production_output_broker']:
  db.run('SET SESSION AUTHORIZATION '+role+"; DO $$ BEGIN BEGIN PERFORM public.character_production_qa_prepare(NULL,NULL); RAISE EXCEPTION 'unexpected prepare'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;")
 for mutation in ["UPDATE character_production.qa_targets SET enabled=false", "UPDATE character_production.approved_slots SET enabled=false", "UPDATE public.cs_character_promo_drafts SET updated_at=updated_at+interval '1 microsecond' WHERE id='"+PID+"'", "UPDATE public.cs_character_promo_drafts SET voice_approved_at=now() WHERE id='"+PID+"'"]:
  db.run('BEGIN; '+mutation+'; DO $$ BEGIN IF '+prepare()+" IS NOT NULL THEN RAISE EXCEPTION 'changed target allowed'; END IF; END $$; ROLLBACK;")
 db.run('DO $$ DECLARE m jsonb:='+prepare()+'; BEGIN IF '+commit(sha='f'*64)+' OR '+commit(path='wrong/path.mp4')+" THEN RAISE EXCEPTION 'wrong media accepted'; END IF; END $$;")
 for schema,message in [('cs_promo_private','Claimed promo is frozen; manual reconciliation required'),('cafe_metricool_private','Café claimed source frozen; reconcile manually')]:
  db.run("BEGIN; INSERT INTO public.cs_character_promo_delivery_plans(id,promo_id,character_id,network,scheduled_at) VALUES('22222222-2222-4222-8222-222222222222','"+PID+"','zaria-solenne','synthetic',now()); INSERT INTO "+schema+".attempts VALUES('22222222-2222-4222-8222-222222222222'); DO $$ DECLARE m jsonb:="+prepare()+"; BEGIN IF m IS NULL THEN RAISE EXCEPTION 'frozen fixture absent'; END IF; BEGIN PERFORM "+commit()+"; RAISE EXCEPTION 'frozen copy accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>"+db.quote(message)+" THEN RAISE; END IF; END; IF EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts) THEN RAISE EXCEPTION 'partial receipt'; END IF; END $$; ROLLBACK;")
 db.run('SET SESSION AUTHORIZATION service_role; DO $$ DECLARE m jsonb:='+prepare()+'; BEGIN IF NOT '+commit()+' OR NOT '+commit()+" THEN RAISE EXCEPTION 'copy CAS/replay failed'; END IF; END $$;")
 db.check("(SELECT count(*)=1 FROM character_production.qa_ingestion_receipts)",'one immutable receipt')
 db.check("(SELECT status='draft' AND voice_approved_at IS NULL AND video_qa_approved_at IS NULL AND publication_approved_at IS NULL FROM public.cs_character_promo_drafts WHERE id='"+PID+"')",'never approved or published')
 db.check("(SELECT reserved_cents=35 AND cap_cents=40 FROM character_production.budgets WHERE provider='heygen' AND period='2026-11')",'budget unchanged')
 db.check("(SELECT state='pending_qa' AND task='c8246007ce21cee14e38f409b4492967' FROM character_production.jobs WHERE key="+db.quote(KEY)+')','original job unchanged')
 db.finish('qa-install')
if __name__=='__main__':suite()
