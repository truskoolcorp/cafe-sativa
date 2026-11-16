"""Disposable PG17 source rehearsal only. No paid call or live installation."""
import concurrent.futures, json
import validate_ledger as db
import validate_planner_install as foundation

def suite():
 foundation.suite()
 db.check("current_setting('server_version_num')::integer BETWEEN 170000 AND 179999",'PG17 only')
 source=(db.ROOT/'docs/proposals/character-production-replenishment.sql').read_text()
 assert source.rstrip().endswith('ROLLBACK;')
 db.run('GRANT CREATE ON SCHEMA public TO character_production_owner; SET ROLE character_production_owner; '+source)
 db.check("to_regclass('character_production.text_replenishment_attempts') IS NULL",'rollback source')
 db.run('SET ROLE character_production_owner; '+source.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run('REVOKE CREATE ON SCHEMA public FROM character_production_owner')
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_table_privilege('+db.quote(role)+",'character_production.text_replenishment_attempts','SELECT,INSERT,UPDATE,DELETE')",'no runtime table privileges')
  db.check('NOT has_function_privilege('+db.quote(role)+",'public.character_production_text_claim(text,text,jsonb,uuid,text,integer,integer,text,bigint,integer,integer)','EXECUTE')",'no runtime claim grant')
 budget='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
 db.run("SET ROLE character_production_owner; INSERT INTO character_production.text_replenishment_budgets(id,period,model,input_micro_usd,output_micro_usd,max_cost_cents,cap_cents,rate_evidence,expires_at,enabled) VALUES('"+budget+"',to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM'),'claude-haiku-4-5-20251001',1,3,10,20,'test rate ceiling',date_trunc('second',clock_timestamp())+interval '1 hour',true)")
 day=db.run("SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')").strip()
 period=day[:7]
 expiry=db.run("SELECT floor(extract(epoch FROM expires_at)*1000)::bigint FROM character_production.text_replenishment_budgets").strip()
 digest='a'*64
 def claim(character='zaria',key=None):
  key=key or 'daily:'+day+':'+character
  return "SELECT public.character_production_text_claim("+','.join([db.quote(key),db.quote(digest),db.quote(json.dumps({'characterId':character}))+'::jsonb',db.quote(budget),db.quote(period),'10','20',db.quote('test rate ceiling'),expiry,'1','3'])+")"
 def run(sql):return db.run('SET ROLE character_production_owner; '+sql).strip()
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(run,[claim(),claim()]))
 tokens=[s for s in results if s]
 assert len(tokens)==1,results
 assert run(claim())==''
 assert run(claim(key='random-other-key'))==''
 assert run(claim('ahnika'))!=''
 assert run(claim('ginger'))==''
 db.check("(SELECT reserved_cents=20 FROM character_production.text_replenishment_budgets)",'all-in reservation cap')
 token=tokens[0];key='daily:'+day+':zaria'
 def authorized(tok=token,sha=digest):
  return "SELECT public.character_production_text_authorized("+','.join([db.quote(key),db.quote(tok),db.quote(sha),db.quote(budget),expiry,'1','3','10','20',db.quote('test rate ceiling')])+")"
 assert run(authorized())=='t'
 assert run(authorized(sha='b'*64))=='f'
 assert run(authorized(tok='dddddddd-dddd-4ddd-8ddd-dddddddddddd'))=='f'
 db.run("UPDATE character_production.text_replenishment_budgets SET enabled=false")
 assert run(authorized())=='f'
 db.run("UPDATE character_production.text_replenishment_budgets SET enabled=true")
 def save(tok=token,sha=digest):
  return "SELECT public.character_production_text_save("+','.join([db.quote(key),db.quote(tok),db.quote(sha),db.quote(json.dumps({'spokenScript':'Synthetic source-only PG fixture script'}))+'::jsonb',db.quote('fixture-provider'),'100','50'])+")"
 assert run(save(tok='dddddddd-dddd-4ddd-8ddd-dddddddddddd'))=='f'
 assert run(save(sha='b'*64))=='f'
 assert run(save())=='t'
 assert run(save())=='f' and run(authorized())=='f' and run(claim())==''
 for role in ['anon','authenticated','service_role']:
  db.check('NOT has_table_privilege('+db.quote(role)+",'character_production.text_replenishment_budgets','SELECT,INSERT,UPDATE,DELETE')",'no runtime budget table privileges')
  for signature in ['character_production_text_authorized(text,uuid,text,uuid,bigint,integer,integer,integer,integer,text)','character_production_text_save(text,uuid,text,jsonb,text,integer,integer)']:
   db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote('public.'+signature)+",'EXECUTE')",'no runtime authorization/save grants')
 db.check("(SELECT state='claimed' FROM character_production.text_replenishment_attempts WHERE key="+db.quote('daily:'+day+':ahnika')+")",'unknown attempt remains claimed')
 assert run(claim('ahnika'))==''
 db.finish('replenishment')

if __name__=='__main__':suite()
