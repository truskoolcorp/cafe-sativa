"""Isolated PG17 bounded checkpoint; no live reads, writes or providers."""
import hashlib,json
import validate_ledger as db
import validate_text_receipt_evidence_install as receipt_install
K='synthetic:checkpoint';T='11111111-1111-4111-8111-111111111111';B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';D='a'*64
CONTENT='[{"text":"Synthetic private content","type":"text"}]'
def write(content=CONTENT,key=K,token=T,digest=D,sha=None):
 if sha is None:sha=hashlib.sha256(content.encode()).hexdigest()
 args=[key,token,digest,'msg_12345678',None,'claude-haiku-4-5-20251001','end_turn',12,8,sha,content]
 return 'public.character_production_text_checkpoint('+','.join('NULL' if v is None else db.quote(v) for v in args)+')'
def read(key=K,token=T,digest=D):return 'public.character_production_text_checkpoint_read('+','.join(db.quote(v) for v in [key,token,digest])+')'
def suite():
 receipt_install.suite()
 src=(db.ROOT/'docs/proposals/character-production-text-checkpoint-install.sql').read_text();prefix='SET SESSION AUTHORIZATION postgres; '
 db.run(prefix+src);db.check("to_regclass('character_production.text_content_checkpoints') IS NULL",'checkpoint default rollback')
 db.run(prefix+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run("SET ROLE character_production_owner; INSERT INTO character_production.text_replenishment_budgets VALUES('"+B+"','2026-11','claude-haiku-4-5-20251001',1,5,10,10,10,'synthetic-only','2000-01-01',false); INSERT INTO character_production.text_replenishment_attempts(key,token,budget_id,source_snapshot,source_digest) VALUES('"+K+"','"+T+"','"+B+"','{}',repeat('a',64));")
 for args in [dict(content='{}'),dict(content='invalid'),dict(content='['+' '*262144+']'),dict(sha='b'*64),dict(digest='c'*64),dict(key='daily:2026-11-16:zaria-solenne')]:db.check('NOT '+write(**args),'invalid/frozen checkpoint rejected')
 db.check("(SELECT count(*)=0 FROM character_production.text_receipt_evidence)",'invalid content creates no receipt')
 db.run('SET ROLE service_role; DO $$ BEGIN IF NOT '+write()+" THEN RAISE EXCEPTION 'checkpoint write failed'; END IF; END $$;")
 unicode_content='[{"text":"\\u0000","type":"text"}]'
 unicode_write=write(content=unicode_content,key='synthetic:unicode',token='22222222-2222-4222-8222-222222222222').replace('msg_12345678','msg_87654321')
 db.run("BEGIN; SET ROLE character_production_owner; INSERT INTO character_production.text_replenishment_attempts(key,token,budget_id,source_snapshot,source_digest) VALUES('synthetic:unicode','22222222-2222-4222-8222-222222222222','"+B+"','{}',repeat('a',64)); DO $$ BEGIN IF NOT "+unicode_write+" THEN RAISE EXCEPTION 'legal escaped Unicode rejected'; END IF; END $$; ROLLBACK;")
 db.check(write(),'identical checkpoint idempotent')
 db.check('NOT '+write(content='[]'),'altered checkpoint rejected')
 db.check(read()+"->>'parserVersion'='fresh-editorial-v1-zaria250'",'fixed historical parser version')
 db.check(read()+"->'sourceSnapshot'='{}'::jsonb",'historical source returned from exact attempt')
 db.check(read()+"->>'contentJson'="+db.quote(CONTENT),'exact content roundtrip')
 db.check(read()+"#>>'{evidence,responseSha256}'="+db.quote(hashlib.sha256(CONTENT.encode()).hexdigest()),'exact content hash')
 db.check(read(digest='c'*64)+' IS NULL','wrong digest read denied')
 db.check(read(token='22222222-2222-4222-8222-222222222222')+' IS NULL','wrong token read denied')
 for role in ['anon','authenticated']:
  try:db.run('SET ROLE '+role+'; SELECT '+read())
  except RuntimeError as e:assert 'permission denied' in str(e)
  else:raise AssertionError('public read allowed')
 for sql in ["UPDATE character_production.text_content_checkpoints SET content_json='[]'","DELETE FROM character_production.text_content_checkpoints","TRUNCATE character_production.text_content_checkpoints"]:
  try:db.run('SET ROLE character_production_owner; '+sql)
  except RuntimeError as e:assert 'append-only' in str(e)
  else:raise AssertionError('checkpoint mutated')
 db.check("(SELECT state='claimed' AND output IS NULL FROM character_production.text_replenishment_attempts WHERE key='"+K+"') AND (SELECT reserved_cents=10 AND NOT enabled FROM character_production.text_replenishment_budgets WHERE id='"+B+"')",'no output/state/budget/authority change')
 db.check("NOT pg_has_role('postgres','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'installer temporary privileges removed')
 db.finish('text-checkpoint')
if __name__=='__main__':suite()
