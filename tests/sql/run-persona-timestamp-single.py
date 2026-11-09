"""Real SQL -> real TS reader/model -> real SQL regression, offline PG17 single-user.
Arguments: PG17 bin directory, share directory, fresh evidence directory.
No sockets/listeners/network. Storage, GLYPH and provider data are synthetic mocks.
"""
from pathlib import Path
import atexit,hashlib,json,os,re,subprocess,sys,uuid
ROOT=Path(__file__).resolve().parents[2]
HOSTED=sys.argv[1:2]==['--hosted-ci']
if HOSTED:
    assert os.environ.get('CI')=='true' and os.environ.get('PGHOST')=='127.0.0.1' and os.environ.get('PGUSER')=='postgres','Requires isolated localhost CI PostgreSQL'
    OUT=Path(sys.argv[2]).resolve();OUT.mkdir(parents=True,exist_ok=False)
    env=dict(os.environ,PGDATABASE='persona_timestamp_'+uuid.uuid4().hex)
    subprocess.run(['createdb',env['PGDATABASE']],env=env,check=True)
    atexit.register(lambda: subprocess.run(['dropdb','--if-exists',env['PGDATABASE']],env=env,check=False))
else:
    BIN,SHARE,OUT=map(lambda x:Path(x).resolve(),sys.argv[1:])
    subprocess.run([sys.executable,str(ROOT/'tests/sql/run-persona-authoring-single.py'),str(BIN),str(SHARE),str(OUT)],check=True,cwd=ROOT)
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
def sql(label,content):
    if HOSTED:
        command=['psql','-X','-At','-v','ON_ERROR_STOP=1']
    else:
        assert not (OUT/'pgdata/postmaster.pid').exists()
        command=[str(BIN/'postgres'),'--single','-j','-D',str(OUT/'pgdata'),'-c','TimeZone=UTC','postgres']
    content='\n'.join(x for x in content.splitlines() if x.strip())+'\n\n'
    r=subprocess.run(command,input=content,text=True,capture_output=True,env=env,timeout=60)
    output=r.stdout+r.stderr
    (OUT/(label+'.log')).write_text(output)
    assert r.returncode==0 and not any(x in output for x in ['ERROR:','FATAL:','PANIC:']),output[-4000:]
    return output
if HOSTED:
    for i,file in enumerate(['tests/sql/persona-ledger-fixture.sql','supabase/migrations/20261020154000_character_canon_spoken_promos.sql','supabase/migrations/20261020173000_character_promo_qa_checks.sql','supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql','docs/proposals/persona-delivery-ledger.sql','tests/sql/persona-gates-seed.sql','docs/proposals/persona-approval-gates.sql','docs/proposals/persona-owner-revocation.sql']):
        sql('install-'+str(i),(ROOT/file).read_text())
plan='00000000-0000-0000-0000-000000000020'; actor='00000000-0000-0000-0000-000000000001'
sha=hashlib.sha256(b'0000ftypisom0000000000000000000').hexdigest()
sql('prepare',f"""update public.cs_character_promo_drafts set video_asset_path=replace(video_asset_path,repeat('a',64),'{sha}'),voice_approved_at=null,video_qa_approved_at=null,publication_approved_at=null;
update public.cs_character_promo_qa_checks set video_sha256='{sha}';
update public.cs_character_promo_delivery_plans set scheduled_at='2099-01-01T12:00:00.000Z',status='blocked_assets';""")
overrides={}
def read(label,micro=False,final=False,expectedNextAction=None):
    output=sql(label+'-export',f"""select encode(convert_to(jsonb_build_object('draft',to_jsonb(d),'plan',to_jsonb(p),'qa',(select jsonb_agg(to_jsonb(q) order by q.id) from public.cs_character_promo_qa_checks q),'state',public.cs_read_character_promo_gates(p.id))::text,'UTF8'),'hex') payload from public.cs_character_promo_delivery_plans p join public.cs_character_promo_drafts d on d.id=p.promo_id;""")
    m=re.search(r'^([0-9a-f]+)$',output,re.M) if HOSTED else re.search(r'payload = "([0-9a-f]+)"',output);assert m,output
    data=json.loads(bytes.fromhex(m.group(1)));data.update(requireMicroseconds=micro,final=final,expectedNextAction=expectedNextAction,**overrides)
    source=OUT/(label+'-rows.json');target=OUT/(label+'-payload.json');source.write_text(json.dumps(data,indent=2)+'\n')
    r=subprocess.run(['node','tests/sql/persona-timestamp-reader.cjs',str(source),str(target)],cwd=ROOT,text=True,capture_output=True)
    (OUT/(label+'-reader.log')).write_text(r.stdout+r.stderr)
    assert r.returncode==0,r.stdout+r.stderr
    return json.loads(target.read_text())
def lit(x):return "'"+json.dumps(x,separators=(',',':')).replace("'","''")+"'::jsonb"
r=read('initial')
sql('begin',f"select assert_ok(public.cs_begin_character_promo_review('{plan}',{lit(r['content'])},'{r['digest']}',{lit(r['expected'])},'{actor}') is not null,'real reader begins generation');")
r=read('begun',expectedNextAction='voice')
# Before first gate, external canon/timezone changes do not change draft/QA rows.
# Real reader content digest must detect this even though the generation has no gates.
for kind,key,value in [('canon','canonOverride','Explicitly changed synthetic canon'),('timezone','timezoneOverride','America/Chicago')]:
    prior=r
    overrides[key]=value
    changed=read(kind+'-drift',expectedNextAction='replace_review')
    assert changed['digest']!=prior['digest']
    sql(kind+'-refuse-stale-generation',f"select assert_ok(public.cs_confirm_character_promo_gate('{plan}',{lit(changed['content'])},'{changed['digest']}',{lit(changed['expected'])},'voice','{actor}') is null,'fresh content cannot attach to old generation');")
    sql(kind+'-replace',f"select assert_ok(public.cs_begin_character_promo_review('{plan}',{lit(changed['content'])},'{changed['digest']}',{lit(changed['expected'])},'{actor}')->>'generationContentDigest'='{changed['digest']}','explicit replacement exposes real JS content digest');")
    r=read(kind+'-replaced',expectedNextAction='voice')
    sql(kind+'-zero-gates',"select assert_ok((select count(*)=0 from cs_promo_private.gates),'replacement grants zero gates');")
# Generate the stamp only inside the real voice RPC, never synthesize fractional digits.
sql('voice',f"""do $$ declare tries int; accepted boolean:=false; begin
 for tries in 1..10 loop
  begin
   perform assert_ok(public.cs_confirm_character_promo_gate('{plan}',{lit(r['content'])},'{r['digest']}',{lit(r['expected'])},'voice','{actor}') is not null,'real voice gate');
   if (select mod(extract(microseconds from voice_approved_at)::bigint,1000)=0 from public.cs_character_promo_drafts) then
    raise exception using errcode='PZ001',message='Fixture-only rollback and resample exact-millisecond clock';
   end if;
   accepted:=true; exit;
  exception when sqlstate 'PZ001' then null;
  end;
 end loop;
 perform assert_ok(accepted,'real clock_timestamp must have nonzero submillisecond precision after bounded fixture resampling');
end $$;""")
r=read('after-voice',True);assert r['nextAction']=='video',r
truncated=dict(r['expected'])
for key in ['draftRevision','voiceApprovedAt']:
    truncated[key]=re.sub(r'(\.\d{3})\d+(Z)$',r'\1\2',truncated[key])
assert truncated!=r['expected']
sql('truncation-negative-control',f"select assert_ok(public.cs_confirm_character_promo_gate('{plan}',{lit(r['content'])},'{r['digest']}',{lit(truncated)},'video','{actor}') is null,'millisecond truncation reproduces next-gate CAS failure');")
sql('video',f"select assert_ok(public.cs_confirm_character_promo_gate('{plan}',{lit(r['content'])},'{r['digest']}',{lit(r['expected'])},'video','{actor}') is not null,'precision-preserving reader passes next video CAS');")
r=read('after-video',True);assert r['nextAction']=='publication',r
sql('publication',f"select assert_ok(public.cs_confirm_character_promo_gate('{plan}',{lit(r['content'])},'{r['digest']}',{lit(r['expected'])},'publication','{actor}') is not null,'precision-preserving publication CAS');")
r=read('final',True,True)
sql('final-approval',f"select assert_ok(public.cs_approve_character_promo('{plan}','{r['snapshotDigest']}',{lit(r['snapshot'])},clock_timestamp(),'{actor}'),'real SQL accepts exact final snapshot from reader');")
(OUT/'timestamp-results.json').write_text(json.dumps({'passed':['pre-first-gate canon and timezone drift SQL to TS replace_review and explicit replacement', 'real clock_timestamp nonzero microseconds','SQL rows through actual TS source reader and review model','truncated next-gate negative control','exact video and publication CAS','exact final snapshot accepted by SQL'],'mode':('hosted isolated PG17' if HOSTED else 'PG17 single-user')+', mocked external data only'},indent=2)+'\n')
print('PASS: actual SQL → TS reader → next gates → final SQL approval retains microseconds; truncation negative control fails closed')
