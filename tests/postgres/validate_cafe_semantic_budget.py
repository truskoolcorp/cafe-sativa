#!/usr/bin/env python3
"""Disposable PG17 only. No production connection, grant or default budget."""
import os,pathlib,subprocess,json,concurrent.futures,time
R=pathlib.Path(__file__).resolve().parents[2]
assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes'
assert os.environ.get('PGHOST') in ('127.0.0.1','localhost','::1')
assert os.environ.get('PGDATABASE')=='character_ci_semantic'
def run(s,ok=True):
 p=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True,timeout=30)
 if ok: assert p.returncode==0,p.stderr
 else: assert p.returncode!=0,p.stdout
 return p.stdout.strip()
assert run('SHOW server_version_num')[:2]=='17'
run('CREATE ROLE cafe_metricool_owner NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE SCHEMA cafe_metricool_private AUTHORIZATION cafe_metricool_owner; GRANT CREATE ON SCHEMA public TO cafe_metricool_owner;')
sql=(R/'docs/proposals/cafe-semantic-budget.sql').read_text()
run(sql.replace('\nROLLBACK;','\nCOMMIT;'))
run('REVOKE CREATE ON SCHEMA public FROM cafe_metricool_owner;')
B='11111111-1111-4111-8111-111111111111';K='cafe-semantic-v1:'+'a'*64
reserve=lambda k=K:f"SET ROLE cafe_metricool_owner; SELECT public.cs_reserve_cafe_semantic_attempt('{B}','{k}',100);"
assert run(reserve())=='f','absent budget must deny'
for role in ('anon','authenticated','service_role'):
 run(f"SET ROLE {role}; SELECT public.cs_reserve_cafe_semantic_attempt('{B}','{K}',100);",False)
run(f"SET ROLE cafe_metricool_owner; INSERT INTO cafe_metricool_private.semantic_budgets VALUES('{B}','fixture-account','fixture-ceiling',100,'fixture-rate','fixture-only-owner','claude-haiku-4-5-20251001',now()-interval '1 minute',now()+interval '1 hour',1000,1,1,0,false);")
with concurrent.futures.ThreadPoolExecutor(2) as ex: results=list(ex.map(lambda _:run(reserve()),range(2)))
assert sorted(results)==['f','t'],results
assert run(reserve())=='f'
assert run('SELECT reserved_micro_usd FROM cafe_metricool_private.semantic_budgets')=='356'
# Ambiguous/no result never refunds or unlocks the key. Different key consumes separate allowance.
assert run(reserve('cafe-semantic-v1:'+'b'*64))=='t'
assert run(reserve('cafe-semantic-v1:'+'c'*64))=='f'
receipt={'key':K,'requestId':'msg_fixture','model':'claude-haiku-4-5-20251001','inputTokens':100,'outputTokens':25,'resultSha256':'d'*64,'classification':[{'type':'tool_use','input':{'classification':'uncertain'}}]}
def finish(v):return run("SET ROLE cafe_metricool_owner; SELECT public.cs_finish_cafe_semantic_attempt('"+K+"','"+json.dumps(v)+"'::jsonb);")
assert finish({**receipt,'inputTokens':101})=='f'
assert finish(receipt)=='t'
assert finish(receipt)=='f','receipt insert-once'
assert run('SELECT reserved_micro_usd FROM cafe_metricool_private.semantic_budgets')=='712','no billing refund'
run('UPDATE cafe_metricool_private.semantic_budgets SET revoked=true;')
assert run(reserve('cafe-semantic-v1:'+'e'*64))=='f'
print('PASS absent/denied budget, same-key concurrency, cap, permanent hold, bounded insert-once receipt, revocation, no runtime grant')

# A reservation queued behind a locked budget must use the post-lock clock.
# Hold the row, wait until the other connection is actually waiting, expire it,
# then release. No paid operation or remote database is involved.
run("UPDATE cafe_metricool_private.semantic_budgets SET revoked=false,cap_micro_usd=10000,ends_at=clock_timestamp()+interval '1 hour';")
holder=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
holder.stdin.write("BEGIN; SELECT id FROM cafe_metricool_private.semantic_budgets FOR UPDATE;\n");holder.stdin.flush()
assert holder.stdout.readline().strip()==B
with concurrent.futures.ThreadPoolExecutor(1) as ex:
 future=ex.submit(run,"SET application_name='semantic_expiry_waiter'; "+reserve('cafe-semantic-v1:'+'f'*64))
 for _ in range(100):
  if run("SELECT count(*) FROM pg_stat_activity WHERE application_name='semantic_expiry_waiter' AND wait_event_type='Lock'")=='1': break
  time.sleep(.02)
 else: raise AssertionError('reservation did not reach row-lock wait')
 holder.stdin.write("UPDATE cafe_metricool_private.semantic_budgets SET ends_at=clock_timestamp(); COMMIT;\n");holder.stdin.close()
 assert holder.wait(timeout=5)==0,holder.stderr.read()
 assert future.result()=='f','reservation after expiry must deny'
assert run("SELECT count(*) FROM cafe_metricool_private.semantic_attempts WHERE review_key='cafe-semantic-v1:"+'f'*64+"'")=='0'
print('PASS post-lock expiry denies reservation without consuming attempt')
