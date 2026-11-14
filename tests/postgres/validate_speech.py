#!/usr/bin/env python3
"""Synthetic speech ledger reservation/provenance; no provider/network calls."""
import os,json,time,hashlib,subprocess,concurrent.futures
os.environ['PG_TEST_SERVER']='1'
import validate_ledger as db

def suite():
 db.command();os.environ['PGDATABASE']='character_ci_provision'
 source=(db.ROOT/'docs/proposals/character-production-speech.sql').read_text()
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source.replace('COMMIT;','ROLLBACK;')+' RESET ROLE;')
 db.check("to_regclass('character_production.speech_jobs') IS NULL",'speech rollback')
 db.run('SET ROLE character_production_owner; '+source+' RESET ROLE; REVOKE CREATE ON SCHEMA public FROM character_production_owner;')
 period=time.strftime('%Y-%m',time.gmtime())
 slot=dict(key='one',authorizationId='approval',accountBinding='speech-account',characterId='synthetic',avatarId='avatar',voiceId='voice',voiceModel='eleven_v4',canonicalRevision='a'*64,portraitSha256='b'*64,script='Exact script',period=period,expiresAt=int(time.time()*1000)+600000,quoteCents=10,periodCapCents=20,maxCharacters=100)
 def encoded(x):return db.quote(json.dumps(x,separators=(',',':')))+'::jsonb'
 db.run("INSERT INTO character_production.speech_budgets(account,period,cap_cents,enabled) VALUES('speech-account',"+db.quote(period)+",20,true);")
 for key in ['one','two','three']:
  s={**slot,'key':key};db.run('INSERT INTO character_production.speech_authorizations(key,slot,digest,enabled) VALUES('+db.quote(key)+','+encoded(s)+",repeat('d',64),true)")
 def claim(key):return "public.character_production_speech_claim((SELECT slot FROM character_production.speech_authorizations WHERE key="+db.quote(key)+"),repeat('d',64))"
 # Race three separate backend connections against a shared cost cap.
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
  list(executor.map(lambda key:db.run('SELECT '+claim(key)),['one','two','three']))
 db.check("(SELECT count(*)=2 FROM character_production.speech_jobs)",'cumulative speech budget bounds concurrency')
 db.check("(SELECT reserved_cents=20 FROM character_production.speech_budgets)",'separate speech cap charged once')
 key=db.run('SELECT key FROM character_production.speech_jobs ORDER BY key LIMIT 1')
 db.check(claim(key)+' IS NULL','never reclaim speech key')
 token=db.run('SELECT token FROM character_production.speech_jobs WHERE key='+db.quote(key))
 manifest=dict(characterId='synthetic',avatarId='avatar',voiceId='voice',voiceModel='eleven_v4',canonicalRevision='a'*64,portraitSha256='b'*64,scriptSha256=hashlib.sha256(slot['script'].encode()).hexdigest(),audioSha256='c'*64,audioBytes=16,mime='audio/mpeg',provider='elevenlabs',synthesisReceiptId='receipt-one')
 def render(m=manifest,t=token):return 'public.character_production_speech_rendered('+db.quote(key)+','+('NULL' if t is None else db.quote(t))+",repeat('d',64),"+encoded(m)+",repeat('e',64))"
 db.check('NOT '+render(t=None),'null proof denied')
 db.check('NOT '+render({**manifest,'voiceId':'wrong'}),'voice substitution denied')
 db.check(render(),'exact provider provenance accepted')
 db.run("UPDATE character_production.speech_budgets SET enabled=false")
 verify='public.character_production_speech_verified('+db.quote(key)+','+db.quote(token)+",repeat('d',64),"+encoded(manifest)+",repeat('e',64))"
 db.check('NOT '+verify,'budget revocation blocks attestation')
 db.run("UPDATE character_production.speech_budgets SET enabled=true")
 db.check(verify,'pendingQA after trusted backend readback')
 db.check("(SELECT state='pending_qa' FROM character_production.speech_jobs WHERE key="+db.quote(key)+')','no auto approval')
 other=db.run('SELECT key FROM character_production.speech_jobs WHERE key<>'+db.quote(key))
 db.run('SELECT public.character_production_speech_unknown(key,token::text) FROM character_production.speech_jobs WHERE key='+db.quote(other))
 db.check(claim(other)+' IS NULL','unknown speech never retried')
 db.check("(SELECT reserved_cents=20 FROM character_production.speech_budgets)",'unknown no refund')
 for role in ['anon','authenticated','service_role','character_production_generator','character_production_output_broker']:
  db.check("NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname LIKE 'character_production_speech_%' AND has_function_privilege("+db.quote(role)+",oid,'EXECUTE'))",'no unreviewed speech grants')
 db.finish('speech')
if __name__=='__main__':suite()
