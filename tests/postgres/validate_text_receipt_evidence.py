"""Isolated PG17 receipt metadata assertions. Never providers/live credentials."""
import validate_ledger as db
B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';T='11111111-1111-4111-8111-111111111111';U='22222222-2222-4222-8222-222222222222';F='33333333-3333-4333-8333-333333333333'
K='synthetic:future-receipt';FK='daily:2026-11-16:zaria-solenne'
SIG='public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text)'
def call(key=K,token=T,digest='a'*64,provider='msg_12345678',request=None,model='claude-haiku-4-5-20251001',reason='end_turn',inputs=12,outputs=8,sha='b'*64):
 return 'public.character_production_text_receipt('+','.join('NULL' if v is None else db.quote(v) for v in [key,token,digest,provider,request,model,reason,inputs,outputs,sha])+')'
def suite():
 db.check("to_regnamespace('character_production') IS NULL",'fresh disposable cluster required')
 db.check("current_setting('server_version_num')::int BETWEEN 170000 AND 179999",'PG17 required')
 db.run("CREATE ROLE character_production_owner NOLOGIN NOINHERIT; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA character_production AUTHORIZATION character_production_owner; GRANT CREATE ON SCHEMA public TO character_production_owner;")
 src=(db.ROOT/'docs/proposals/character-production-replenishment.sql').read_text();db.run('SET ROLE character_production_owner; '+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run("SET ROLE character_production_owner; INSERT INTO character_production.text_replenishment_budgets VALUES('"+B+"','2026-11','claude-haiku-4-5-20251001',1,5,10,10,10,'synthetic-only','2000-01-01T00:00:00Z',false); INSERT INTO character_production.text_replenishment_attempts(key,token,budget_id,source_snapshot,source_digest) VALUES('"+K+"','"+T+"','"+B+"','{}',repeat('a',64)),('synthetic:other','"+U+"','"+B+"','{}',repeat('a',64)),('"+FK+"','"+F+"','"+B+"','{}',repeat('a',64));")
 src=(db.ROOT/'docs/proposals/character-production-text-receipt-evidence.sql').read_text()
 db.run('SET ROLE character_production_owner; '+src)
 db.check("to_regclass('character_production.text_receipt_evidence') IS NULL",'default rollback')
 db.run('SET ROLE character_production_owner; '+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 for role in ['anon','authenticated','service_role']:
  db.check("NOT has_table_privilege('"+role+"','character_production.text_receipt_evidence','SELECT,INSERT,UPDATE,DELETE')",'no data grants')
  db.check("NOT has_function_privilege('"+role+"','"+SIG+"','EXECUTE')",'no RPC grants')
  try:db.run('SET ROLE '+role+'; SELECT '+call())
  except RuntimeError as e:assert 'permission denied' in str(e)
  else:raise AssertionError('unauthorized RPC allowed')
 for args in [dict(key=FK,token=F),dict(key=None),dict(token=None),dict(token=U),dict(digest='c'*64),dict(key='missing'),dict(provider='raw content'),dict(provider='msg_short'),dict(request='requestsecret'),dict(request='req_short'),dict(model='other'),dict(reason=None),dict(reason='unknown'),dict(inputs=-1),dict(inputs=200001),dict(outputs=-1),dict(outputs=1025),dict(sha='invalid')]:
  db.check('NOT '+call(**args),'invalid/frozen receipt denied')
 db.check(call(),'receipt recorded after expired/disabled budget without dispatch authority')
 db.check(call(),'identical evidence idempotent')
 for args in [dict(provider='msg_87654321'),dict(request='req_12345678'),dict(reason='max_tokens'),dict(inputs=13),dict(outputs=9),dict(sha='c'*64),dict(key='synthetic:other',token=U)]:
  db.check('NOT '+call(**args),'changed duplicate or reused provider receipt denied')
 db.check("(SELECT count(*)=1 FROM character_production.text_receipt_evidence)",'one original evidence row')
 for sql in ["UPDATE character_production.text_receipt_evidence SET response_sha256=repeat('c',64)","DELETE FROM character_production.text_receipt_evidence","TRUNCATE character_production.text_receipt_evidence"]:
  try:db.run('SET ROLE character_production_owner; '+sql)
  except RuntimeError as e:assert 'append-only' in str(e)
  else:raise AssertionError('evidence changed')
 # Direct-owner inserts cannot forge key/token correspondence or frozen key.
 for key,token in [(FK,F),('synthetic:other',T)]:
  sql="INSERT INTO character_production.text_receipt_evidence(attempt_key,attempt_token,source_digest,provider_id,model,stop_reason,input_tokens,output_tokens,response_sha256) VALUES("+','.join(db.quote(v) for v in [key,token,'a'*64,'msg_99999999','claude-haiku-4-5-20251001','end_turn',1,1,'b'*64])+")"
  try:db.run('SET ROLE character_production_owner; '+sql)
  except RuntimeError as e:assert 'check constraint' in str(e) or 'Exact attempt identity' in str(e)
  else:raise AssertionError('direct forged/frozen insert')
 db.check("(SELECT count(*)=3 AND bool_and(state='claimed' AND output IS NULL AND provider_id IS NULL AND input_tokens IS NULL AND output_tokens IS NULL) FROM character_production.text_replenishment_attempts)",'no output, receipt identity or state advance on original attempts')
 db.check("(SELECT reserved_cents=10 AND NOT enabled FROM character_production.text_replenishment_budgets)",'no budget release or authority change')
 db.finish('text-receipt-evidence')
if __name__=='__main__':suite()
