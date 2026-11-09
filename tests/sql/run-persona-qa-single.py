"""Offline isolated PG17 single-user fixture. No sockets, network or credentials.
Run: python tests/sql/run-persona-qa-single.py /path/to/pg17/bin /path/to/pg17/share /new/evidence/path
"""
from pathlib import Path
import os, subprocess, sys, json
ROOT=Path(__file__).resolve().parents[2]
BIN,SHARE,OUT=map(lambda x:Path(x).resolve(),sys.argv[1:])
OUT.mkdir(parents=True,exist_ok=False)
DATA=OUT/'pgdata'
env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
r=subprocess.run([str(BIN/'initdb'),'-D',str(DATA),'-L',str(SHARE),'-U','postgres','--no-locale','--encoding=UTF8','--auth=trust'],capture_output=True,text=True,env=env,check=True)
(OUT/'initdb.log').write_text(r.stdout+r.stderr)
files=['tests/sql/persona-ledger-fixture.sql','supabase/migrations/20261020154000_character_canon_spoken_promos.sql','supabase/migrations/20261020173000_character_promo_qa_checks.sql','supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql','docs/proposals/persona-delivery-ledger.sql','tests/sql/persona-gates-seed.sql','docs/proposals/persona-approval-gates.sql','docs/proposals/persona-owner-revocation.sql','docs/proposals/persona-qa-observation.sql','tests/sql/persona-qa-observation-tests.sql']
for i,file in enumerate(files):
    assert not (DATA/'postmaster.pid').exists()
    sql='\n'.join(line for line in (ROOT/file).read_text().splitlines() if line.strip())+'\n\n'
    r=subprocess.run([str(BIN/'postgres'),'--single','-j','-D',str(DATA),'-c','TimeZone=UTC','postgres'],input=sql,capture_output=True,text=True,env=env,timeout=60)
    output=r.stdout+r.stderr
    (OUT/f'{i:02d}-{Path(file).name}.log').write_text(output)
    if r.returncode or any(x in output for x in ['ERROR:','FATAL:','PANIC:']):
        raise RuntimeError(f'{file}: {output[-5000:]}')
(OUT/'results.json').write_text(json.dumps({'passed':files,'mode':'PG17 single-user, no concurrent sessions; not production or multi-session race certification'},indent=2)+'\n')
print('PASS: real isolated PG17 proposal install and QA observation assertions. No concurrent-session race tests.')
