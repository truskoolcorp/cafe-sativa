"""Isolated PG17 Nov17 finite path. Simulated clock is TEST ONLY, never installer."""
import json,hashlib,os,concurrent.futures,threading
import validate_ledger as db
import validate_text_checkpoint as checkpoint
K='daily:2026-11-17:zaria-solenne';B='a3db37d4-8a82-4aa0-a2f1-91dc14e5464b';A='b705d45a-5e27-4491-ad9c-d8ca8aa5b9e7'
CTX='public.character_production_finite_test_context()';CLAIM="public.character_production_finite_test_claim(("+CTX+"->>'occurrenceId')::uuid,"
def suite():
 checkpoint.suite()
 db.run("GRANT CREATE ON SCHEMA public TO character_production_owner; CREATE FUNCTION public.cs_cafe_metricool_is_admin(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';")
 for name in ['character-production-fresh-speech-source.sql','character-production-preparation-context.sql']:
  src=(db.ROOT/'docs/proposals'/name).read_text();db.run('SET ROLE character_production_owner; '+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 src=(db.ROOT/'docs/proposals/character-production-finite-test-nov17-install.sql').read_text();prefix='SET SESSION AUTHORIZATION postgres; '
 db.run(prefix+src);db.check("to_regclass('character_production.finite_test_authority') IS NULL",'finite default rollback')
 db.run(prefix+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.check(CTX+' IS NULL','no implicit enrollment')
 db.run("SET ROLE character_production_owner; INSERT INTO character_production.preparation_lanes VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','54b71f3f-19e1-46f0-99e2-28993463caf8','synthetic-original',ARRAY['Sentinel_"+'a'*32+"'],'{\"characterId\":\"zaria-solenne\",\"roomKey\":\"gallery\"}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-11-16T06:00:00Z','2026-11-17T06:00:00Z',false); INSERT INTO character_production.preparation_binding VALUES('zaria-gallery-preparation','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); INSERT INTO character_production.preparation_occurrences(lane_id,id,text_key,text_started) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','de8674ec-61d8-4a79-aca5-a258feb6950b','daily:2026-11-16:zaria-solenne',true); INSERT INTO character_production.text_replenishment_attempts(key,budget_id,source_snapshot,source_digest) VALUES('daily:2026-11-16:zaria-solenne','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{}',repeat('f',64));")
 db.run("CREATE TABLE public.finite_fixture_old_context AS SELECT 'occurrence' kind,md5(to_jsonb(o)::text) hash FROM character_production.preparation_occurrences o UNION ALL SELECT 'binding',md5(to_jsonb(b)::text) FROM character_production.preparation_binding b;")
 # Original tables/data remain present and unchanged throughout future flow.
 db.run("CREATE TABLE public.finite_fixture_baseline AS SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY key),'[]'::jsonb)::text) attempts FROM character_production.text_replenishment_attempts a; CREATE TABLE public.finite_fixture_old_budgets AS SELECT id,md5(to_jsonb(b)::text) hash FROM character_production.text_replenishment_budgets b;")
 enroll=(db.ROOT/'docs/proposals/character-production-finite-test-nov17-enroll.sql').read_text()
 try:db.run(prefix+enroll)
 except RuntimeError as e:assert 'Finite approval window expired' in str(e) or 'Future approval message ID required' in str(e)
 else:raise AssertionError('unapproved enrollment executed')
 # TEST ONLY clock hook replaces clock calls in fixture functions, not production source.
 db.run("CREATE SCHEMA finite_test_fixture; CREATE TABLE finite_test_fixture.clock(stamp timestamptz); INSERT INTO finite_test_fixture.clock VALUES('2026-11-17T12:00:00Z'); CREATE FUNCTION finite_test_fixture.now() RETURNS timestamptz LANGUAGE sql SECURITY DEFINER AS 'SELECT stamp FROM finite_test_fixture.clock'; GRANT USAGE ON SCHEMA finite_test_fixture TO character_production_owner,postgres; DO $$ DECLARE p record; BEGIN FOR p IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'character_production_finite_test_%' OR proname IN('character_production_text_claim','character_production_text_authorized')) LOOP EXECUTE replace(pg_get_functiondef(p.oid),'clock_timestamp()','finite_test_fixture.now()'); END LOOP; END $$;")
 # Approved synthetic message and simulated time only inside disposable rehearsal.
 synthetic=enroll.replace('REPLACE_WITH_NOV17_APPROVAL_MESSAGE_ID','Sentinel_'+'d'*32).replace('clock_timestamp()','finite_test_fixture.now()')
 db.run(prefix+synthetic)
 db.check("(SELECT count(*)=0 FROM character_production.finite_test_authority)",'enroll rollback')
 db.run(prefix+synthetic.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 # Before window and after expiry cannot create occurrence.
 for stamp in ['2026-11-17T05:59:59Z','2026-11-18T06:00:00Z']:
  db.run("UPDATE finite_test_fixture.clock SET stamp='"+stamp+"'");db.check(CTX+' IS NULL','outside date window no admission')
 db.run("UPDATE finite_test_fixture.clock SET stamp='2026-11-17T12:00:00Z'")
 db.check(CTX+"->'active'='true'::jsonb",'finite active exact day')
 for mutation in ["UPDATE character_production.finite_test_authority SET expires_at='2026-11-19T06:00:00Z'","UPDATE character_production.finite_test_authority SET source_scope=source_scope||'{\"topic\":\"changed\"}'::jsonb","DELETE FROM character_production.finite_test_authority"]:
  try:db.run('SET ROLE character_production_owner; '+mutation)
  except RuntimeError as e:assert 'Finite test immutable' in str(e)
  else:raise AssertionError('authority mutation permitted')

 db.run("BEGIN; UPDATE character_production.finite_test_authority SET enabled=false; DO $$ BEGIN IF "+CLAIM+"'text') THEN RAISE EXCEPTION 'revoked admitted'; END IF; END $$; ROLLBACK;")
 db.run("BEGIN; CREATE OR REPLACE FUNCTION public.cs_cafe_metricool_is_admin(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false'; DO $$ BEGIN IF "+CLAIM+"'text') THEN RAISE EXCEPTION 'nonadmin admitted'; END IF; END $$; ROLLBACK;")
 if os.environ.get('PG_TEST_SERVER')=='1':
  barrier=threading.Barrier(8)
  def race(_):
   barrier.wait(timeout=30)
   return db.run('SELECT '+CLAIM+"'text')").strip()
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(race,range(8)))
  assert results.count('t')==1 and results.count('f')==7,results
 else:db.check(CLAIM+"'text')",'text once (serial)')
 db.check('NOT '+CLAIM+"'text')",'unknown claimed text never reset/retried')
 db.run("DO $$ BEGIN BEGIN UPDATE character_production.finite_test_occurrence SET text_started=false; RAISE EXCEPTION 'reset succeeded'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Finite test immutable%' THEN RAISE; END IF; END; END $$;")
 output={'title':'Gallery detail','spokenScript':'Look at the quiet contrast.','visualBrief':'Observe the approved Gallery artwork.','facebookTitle':'Gallery detail','caption':'A moment of observation.','hashtags':[],'collaborators':[]}
 content=json.dumps([{'text':json.dumps(output,separators=(',',':')),'type':'text'}],sort_keys=True,separators=(',',':'));sha=hashlib.sha256(content.encode()).hexdigest();q=db.quote
 db.run("DO $$ DECLARE b character_production.text_replenishment_budgets;t uuid;BEGIN SELECT * INTO b FROM character_production.text_replenishment_budgets WHERE id='"+B+"';t:=public.character_production_text_claim('"+K+"',repeat('a',64),'{\"characterId\":\"zaria-solenne\",\"roomKey\":\"gallery\",\"voiceId\":\"5zneNR4v1Uw5AjIZ9Un4\"}',b.id,b.period,b.max_cost_cents,b.cap_cents,b.rate_evidence,floor(extract(epoch FROM b.expires_at)*1000)::bigint,b.input_micro_usd,b.output_micro_usd);IF t IS NULL THEN RAISE EXCEPTION 'new text claim failed';END IF;IF NOT public.character_production_text_save('"+K+"',t,repeat('a',64),"+q(json.dumps(output))+"::jsonb,'msg_finite12345',12,8) THEN RAISE EXCEPTION 'save failed';END IF;END $$;")
 db.check(CTX+"->'identity'='null'::jsonb",'output without checkpoint not adopted')
 db.check('NOT '+CLAIM+"'speech')",'speech without checkpoint denied')
 db.run("DO $$ DECLARE t uuid;BEGIN SELECT token INTO t FROM character_production.text_replenishment_attempts WHERE key='"+K+"';IF NOT public.character_production_text_checkpoint('"+K+"',t,repeat('a',64),'msg_finite12345',NULL,'claude-haiku-4-5-20251001','end_turn',12,8,"+q(sha)+','+q(content)+") THEN RAISE EXCEPTION 'checkpoint failed';END IF;END $$;")
 db.check(CTX+"->'identity' IS DISTINCT FROM 'null'::jsonb",'exact checkpoint output adopted')
 db.check("public.character_production_finite_test_speech_source('"+K+"')#>>'{attempt,token}'="+CTX+"#>>'{identity,textAttemptToken}'",'exact speech source identity')
 for change in ["provider_id='msg_mismatch123'","input_tokens=99","output=jsonb_set(output,'{spokenScript}',to_jsonb(repeat('x',251)))","output=jsonb_set(output,'{caption}','\"Changed caption\"'::jsonb)"]:
  db.run("BEGIN; UPDATE character_production.text_replenishment_attempts SET "+change+" WHERE key='"+K+"'; DO $$ BEGIN IF "+CTX+"->'identity' IS DISTINCT FROM 'null'::jsonb OR public.character_production_finite_test_speech_source('"+K+"') IS NOT NULL THEN RAISE EXCEPTION 'checkpoint mismatch admitted'; END IF; END $$; ROLLBACK;")
 db.check(CLAIM+"'speech')",'speech once');db.check('NOT '+CLAIM+"'speech')",'speech no repeat')
 db.check(CTX+"->'active'='true'::jsonb",'own monotonic claim does not revoke transport')
 db.run("UPDATE finite_test_fixture.clock SET stamp='2026-11-18T06:00:00Z'")
 db.check(CTX+"->'active'='false'::jsonb",'authority expired');db.check("public.character_production_finite_test_speech_source('"+K+"') IS NULL",'expired speech source absent')
 db.check("(SELECT reserved_cents=10 AND cap_cents=10 FROM character_production.text_replenishment_budgets WHERE id='"+B+"')",'additional cap reserved')
 db.check("NOT EXISTS(SELECT 1 FROM public.finite_fixture_old_budgets f JOIN character_production.text_replenishment_budgets b USING(id) WHERE f.hash<>md5(to_jsonb(b)::text))",'old budgets unchanged')
 db.check("(SELECT attempts FROM public.finite_fixture_baseline)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY key),'[]'::jsonb)::text) FROM character_production.text_replenishment_attempts a WHERE key<>'"+K+"')",'old attempts unchanged')
 db.check("NOT EXISTS((SELECT * FROM public.finite_fixture_old_context EXCEPT (SELECT 'occurrence',md5(to_jsonb(o)::text) FROM character_production.preparation_occurrences o UNION ALL SELECT 'binding',md5(to_jsonb(b)::text) FROM character_production.preparation_binding b))) AND (SELECT count(*)=0 FROM character_production.included_speech_binding)",'original frozen binding/occurrence/speech binding untouched')
 for table in ['finite_test_authority','finite_test_occurrence']:
  try:db.run('SET ROLE character_production_owner; TRUNCATE character_production.'+table+' CASCADE')
  except RuntimeError as e:assert 'Finite test immutable' in str(e)
  else:raise AssertionError('truncate permitted')
 db.finish('finite-test-nov17-simulated-clock')
if __name__=='__main__':suite()
