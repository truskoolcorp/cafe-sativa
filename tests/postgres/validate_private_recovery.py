"""Fresh isolated PG17, no network/providers. Finite Nov16 recovery only."""
import pathlib,subprocess
import validate_ledger as db
O='de8674ec-61d8-4a79-aca5-a258feb6950b'; B='2941c16d-1334-4725-959c-a61c51de2b71'; L='4ee3e7c4-43da-4052-a074-fefcc59cd36d'; A='54b71f3f-19e1-46f0-99e2-28993463caf8'; K='daily:2026-11-16:zaria-solenne'
CTX='public.character_production_private_recovery_context()'; CLAIM="public.character_production_private_recovery_claim('"+O+"')"
def suite():
 db.check("to_regnamespace('character_production') IS NULL",'fresh disposable cluster required')
 db.check("current_setting('server_version_num')::int BETWEEN 170000 AND 179999",'PG17 only')
 db.run("CREATE ROLE character_production_owner NOLOGIN NOINHERIT; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA character_production AUTHORIZATION character_production_owner; GRANT CREATE ON SCHEMA public TO character_production_owner; CREATE FUNCTION public.cs_cafe_metricool_is_admin(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';")
 for file in ['character-production-replenishment.sql','character-production-fresh-speech-source.sql','character-production-preparation-context.sql']:
  src=(db.ROOT/'docs/proposals'/file).read_text();db.run('SET ROLE character_production_owner; '+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 src=(db.ROOT/'docs/proposals/character-production-private-recovery.sql').read_text()
 db.run('SET ROLE character_production_owner; '+src)
 db.check("to_regclass('character_production.private_text_recovery') IS NULL",'default rollback')
 db.run('SET ROLE character_production_owner; '+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run("REVOKE CREATE ON SCHEMA public FROM character_production_owner;")
 for r in ['anon','authenticated','service_role']:
  db.check("NOT has_table_privilege('"+r+"','character_production.private_text_recovery','SELECT,INSERT,UPDATE,DELETE')",'no table grants')
  for fn in [CTX,'public.character_production_private_recovery_claim(uuid)']:
   db.check("NOT has_function_privilege('"+r+"','"+fn+"','EXECUTE')",'no RPC grants')
 db.check(CTX+' IS NULL','unconfigured fails closed')
 db.run("SET ROLE character_production_owner; INSERT INTO character_production.text_replenishment_budgets VALUES('"+B+"','2026-11','claude-haiku-4-5-20251001',1,5,10,10,0,'synthetic-only','2026-11-17T06:00:00Z',true); INSERT INTO character_production.preparation_lanes VALUES('"+L+"','"+A+"','synthetic-recovery',ARRAY['Sentinel_0863ea6c5bf88191837d1497d34b7b7f'],'{\"characterId\":\"zaria-solenne\",\"roomKey\":\"gallery\"}','"+B+"','2026-11-16T13:21:06Z','2026-11-17T06:00:00Z',true); INSERT INTO character_production.preparation_binding VALUES('zaria-gallery-preparation','"+L+"'); INSERT INTO character_production.preparation_occurrences(lane_id,id,text_key,text_started) VALUES('"+L+"','"+O+"','"+K+"',true); INSERT INTO character_production.private_text_recovery(singleton,occurrence_id,budget_id,owner_message_ids,authorized_at,expires_at,enabled) VALUES(true,'"+O+"','"+B+"',ARRAY['Sentinel_b2ad59c6c04481918825fb75684d5837'],'2026-11-16T18:47:44Z','2026-11-17T06:00:00Z',true);")
 db.check(CTX+"->'textStarted'='false'::jsonb AND "+CTX+"->'active'='true'::jsonb",'new recovery separate from original claim')
 db.run("BEGIN; UPDATE character_production.text_replenishment_budgets SET reserved_cents=10; DO $$ BEGIN IF "+CLAIM+" THEN RAISE EXCEPTION 'nonzero budget'; END IF; END $$; ROLLBACK;")
 for key,budget in [(K,B),('daily:2026-11-16:other',B)]:
  db.run("BEGIN; INSERT INTO character_production.text_replenishment_attempts(key,budget_id,source_snapshot,source_digest) VALUES('"+key+"','"+budget+"','{}',repeat('a',64)); DO $$ BEGIN IF "+CLAIM+" THEN RAISE EXCEPTION 'existing attempt'; END IF; END $$; ROLLBACK;")
 db.run("BEGIN; UPDATE character_production.private_text_recovery SET enabled=false; DO $$ BEGIN IF "+CLAIM+" THEN RAISE EXCEPTION 'disabled recovery'; END IF; END $$; ROLLBACK;")
 db.run("BEGIN; UPDATE character_production.preparation_lanes SET enabled=false; DO $$ BEGIN IF "+CLAIM+" THEN RAISE EXCEPTION 'revoked lane'; END IF; END $$; ROLLBACK;")
 db.run("BEGIN; UPDATE character_production.preparation_occurrences SET speech_started=true; DO $$ BEGIN IF "+CLAIM+" THEN RAISE EXCEPTION 'speech already started'; END IF; END $$; ROLLBACK;")
 db.check("NOT public.character_production_private_recovery_claim('00000000-0000-4000-8000-000000000000')",'wrong occurrence denied')
 db.run("BEGIN; CREATE OR REPLACE FUNCTION public.cs_cafe_metricool_is_admin(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false'; DO $$ BEGIN IF "+CLAIM+" THEN RAISE EXCEPTION 'revoked admin'; END IF; END $$; ROLLBACK;")
 db.run("BEGIN; UPDATE character_production.text_replenishment_budgets SET expires_at=clock_timestamp()-interval '1 second'; DO $$ BEGIN IF "+CLAIM+" THEN RAISE EXCEPTION 'expired budget'; END IF; END $$; ROLLBACK;")
 db.check(CLAIM,'one valid claim')
 db.check('NOT '+CLAIM,'no repeat claim')
 db.check(CTX+"->'textStarted'='true'::jsonb AND "+CTX+"->'active'='true'::jsonb",'claimed current remains valid')
 db.run("DO $$ BEGIN BEGIN UPDATE character_production.private_text_recovery SET claimed=false,claimed_at=NULL; RAISE EXCEPTION 'reset accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Private recovery immutable%' THEN RAISE; END IF; END; BEGIN DELETE FROM character_production.private_text_recovery; RAISE EXCEPTION 'delete accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Private recovery immutable%' THEN RAISE; END IF; END; END $$;")
 db.run("DO $$ DECLARE b character_production.text_replenishment_budgets; t uuid; BEGIN SELECT * INTO b FROM character_production.text_replenishment_budgets; t:=public.character_production_text_claim('"+K+"',repeat('a',64),'{\"characterId\":\"zaria-solenne\",\"roomKey\":\"gallery\",\"voiceId\":\"5zneNR4v1Uw5AjIZ9Un4\"}',b.id,b.period,b.max_cost_cents,b.cap_cents,b.rate_evidence,floor(extract(epoch FROM b.expires_at)*1000)::bigint,b.input_micro_usd,b.output_micro_usd); IF t IS NULL THEN RAISE EXCEPTION 'downstream claim'; END IF; IF "+CTX+"->'active' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'current invalid after reservation'; END IF; IF NOT public.character_production_text_save('"+K+"',t,repeat('a',64),'{\"spokenScript\":\"Synthetic recovery only\"}','synthetic-receipt',10,10) THEN RAISE EXCEPTION 'save'; END IF; END $$;")
 db.check("public.character_production_preparation_context()->'identity' IS DISTINCT FROM 'null'::jsonb",'original context recovers same text identity')
 db.check("(SELECT text_started AND NOT speech_started AND text_key='"+K+"' FROM character_production.preparation_occurrences WHERE id='"+O+"')",'original occurrence unchanged')
 db.check("(SELECT reserved_cents=10 FROM character_production.text_replenishment_budgets)",'same budget caps full reservation')
 db.check('NOT '+CLAIM,'saved outcome never replayed')
 db.run("SET ROLE character_production_owner; INSERT INTO character_production.included_speech_scopes VALUES('987087c3-abde-4b75-9d57-b8d72d38aedd','"+A+"','synthetic-speech',ARRAY['Sentinel_0863ea6c5bf88191837d1497d34b7b7f'],'2026-11-16T13:21:06Z','2026-11-17T06:00:00Z',true); INSERT INTO character_production.included_speech_binding VALUES('zaria-gallery-fresh-speech','987087c3-abde-4b75-9d57-b8d72d38aedd',true);")
 db.check("public.character_production_fresh_speech_source('"+K+"')#>>'{attempt,token}'=public.character_production_preparation_context()#>>'{identity,textAttemptToken}'",'speech exact original token')
 db.check("public.character_production_preparation_claim('"+O+"','speech')",'ordinary speech phase once')
 db.check("NOT public.character_production_preparation_claim('"+O+"','speech')",'no repeated speech')
 db.check(CTX+' IS NULL','recovery unusable after speech phase')
 db.finish('private-recovery')
if __name__=='__main__':suite()
