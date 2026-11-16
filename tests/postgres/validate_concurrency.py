#!/usr/bin/env python3
"""Real multi-session tests for a fresh disposable LOCAL PostgreSQL 17 cluster.
NOT executable in the original socket-restricted workspace. CI must produce evidence.
"""
import atexit,itertools,json,os,subprocess,time
os.environ['PG_TEST_SERVER']='1'
os.environ['PGCONNECT_TIMEOUT']='5'
os.environ['PGOPTIONS']='-c statement_timeout=15000 -c lock_timeout=12000 -c idle_in_transaction_session_timeout=20000'
import validate_ledger as db
import validate_qa_bridge as qa
import validate_qa_trigger as guard
BASE=db.command()  # Enforces explicit local host, disposable database and consent.
children=[];labels=itertools.count();results=[]
def cleanup():
 for p in children:
  if p.poll() is None: p.terminate()
 for p in children:
  try: p.communicate(timeout=3)
  except (subprocess.TimeoutExpired,ValueError):
   if p.poll() is None: p.kill();p.wait(timeout=3)
atexit.register(cleanup)
def start(sql,name):
 p=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'PGAPPNAME':name})
 children.append(p);p.stdin.write(sql+'\n');p.stdin.close();p.stdin=None;return p
def finish(p):
 out,err=p.communicate(timeout=18)
 if p.returncode: raise RuntimeError(err)
 return out.strip()
def wait_for(expr,label,timeout=8):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  if db.run('SELECT '+expr+';')=='t': return
  time.sleep(.05)
 raise AssertionError('Expected server state not observed: '+label)
def locked(name):
 wait_for("EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name="+db.quote(name)+" AND wait_event_type='Lock')",name+' lock wait')
def hold(sql):
 name='race_holder_'+str(next(labels))
 p=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'PGAPPNAME':name})
 children.append(p);p.stdin.write('BEGIN; '+sql+'; SELECT 987654321 AS race_ready;\n');p.stdin.flush()
 wait_for("EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name="+db.quote(name)+" AND state='idle in transaction' AND query LIKE 'SELECT 987654321 AS race_ready%' AND wait_event_type IS DISTINCT FROM 'Lock')",name+' acquired')
 return p
def release(p):
 p.stdin.write('COMMIT;\n');p.stdin.close();p.stdin=None;finish(p)
def claim(key): return 'SELECT '+db.claim(key)+' IS NOT NULL;'
def budget(provider,amount): db.check('(SELECT reserved_cents='+str(amount)+' FROM character_production.budgets WHERE provider='+db.quote(provider)+')','budget '+provider)
def main():
 db.suite();qa.suite();guard.suite()
 db.fixture('race-same',['race-same'])
 h=hold("SELECT 1 FROM character_production.budgets WHERE provider='race-same' FOR UPDATE")
 a=start(claim('race-same'),'race_same_a');locked('race_same_a')
 b=start(claim('race-same'),'race_same_b');locked('race_same_b');release(h)
 assert sorted([finish(a),finish(b)])==['f','t'];budget('race-same',40)
 db.check("(SELECT count(*)=1 FROM character_production.jobs WHERE key='race-same')",'single concurrent job')
 results.append('PASS observed simultaneous same-key waits: one claim and one reservation')
 db.fixture('race-budget',['race-budget-a','race-budget-b'],cost=60)
 h=hold("SELECT 1 FROM character_production.budgets WHERE provider='race-budget' FOR UPDATE")
 a=start(claim('race-budget-a'),'race_budget_a');b=start(claim('race-budget-b'),'race_budget_b')
 locked('race_budget_a');locked('race_budget_b');release(h)
 assert sorted([finish(a),finish(b)])==['f','t'];budget('race-budget',60)
 results.append('PASS observed different-key waits on shared budget: cap preserved')
 db.fixture('race-expiry',['race-expiry'],expiry='3 seconds')
 h=hold("SELECT 1 FROM character_production.budgets WHERE provider='race-expiry' FOR UPDATE")
 a=start(claim('race-expiry'),'race_expiry');locked('race_expiry');time.sleep(3.1);release(h)
 assert finish(a)=='f';budget('race-expiry',0)
 results.append('PASS expiry while waiting on budget lock: rejected with no reservation')
 for kind in ['slot','budget']:
  key='race-revoke-'+kind;db.fixture(key,[key])
  statement=('UPDATE character_production.approved_slots SET enabled=false WHERE key=' if kind=='slot' else 'UPDATE character_production.budgets SET enabled=false WHERE provider=')+db.quote(key)
  h=hold(statement);name='race_revoke_'+kind;a=start(claim(key),name);locked(name);release(h)
  assert finish(a)=='f';budget(key,0)
  results.append('PASS '+kind+' revocation while waiting: rejected with no reservation')
 qa.qa_fixture('race-qa',50);qa.draft(51)
 m=json.loads(db.run("SELECT public.character_production_qa_prepare('race-qa',repeat('a',64));"))
 assert m['state']=='copy'
 h=hold('UPDATE character_production.qa_targets SET promo_id='+db.quote(qa.promo(51))+" WHERE job_key='race-qa'")
 q='SELECT '+qa.commit(key="'race-qa'",pid=db.quote(m['promoId'])+'::uuid',stamp=db.quote(m['expectedUpdatedAt'])+'::timestamptz',bucket=db.quote(m['destinationBucket']),path=db.quote(m['destinationPath']))+';'
 a=start(q,'race_qa');locked('race_qa');release(h);assert finish(a)=='f'
 db.check("NOT EXISTS(SELECT 1 FROM character_production.qa_ingestion_receipts WHERE job_key='race-qa')",'race receipt absent')
 db.check('NOT EXISTS(SELECT 1 FROM public.cs_character_promo_drafts WHERE id IN ('+db.quote(qa.promo(50))+','+db.quote(qa.promo(51))+') AND video_asset_path IS NOT NULL)','both race drafts untouched')
 results.append('PASS prepared QA target changed while commit waits: neither draft changed, no receipt')
 (db.ROOT/'evidence').mkdir(exist_ok=True)
 (db.ROOT/'evidence/postgres-concurrency-validation.log').write_text('\n'.join(results)+'\n')
 print('\n'.join(results))
if __name__=='__main__': main()
