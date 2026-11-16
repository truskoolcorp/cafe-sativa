#!/usr/bin/env python3
"""Real single-user PostgreSQL fixtures only; never opens a socket or remote database."""
from pathlib import Path
import argparse, subprocess
parser=argparse.ArgumentParser(); parser.add_argument('--pg-bin',required=True); args=parser.parse_args()
b=Path(__file__).resolve().parents[2];pg=Path(args.pg_bin);root=b/'.local-pg-withdrawal';root.mkdir(exist_ok=True)
base=['tests/sql/persona-ledger-fixture.sql','supabase/migrations/20261020154000_character_canon_spoken_promos.sql','supabase/migrations/20261020173000_character_promo_qa_checks.sql','supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql','docs/proposals/persona-delivery-ledger.sql','tests/sql/persona-gates-seed.sql','docs/proposals/persona-approval-gates.sql','docs/proposals/persona-owner-revocation.sql','docs/proposals/persona-plan-authoring.sql','docs/proposals/persona-plan-withdrawal.sql']
cases={'controls':['tests/sql/persona-plan-withdrawal-tests.sql'],'after-claim':['tests/sql/persona-plan-controls-ready-seed.sql','tests/sql/persona-plan-withdrawal-after-claim.sql'],'restore':['tests/sql/persona-plan-controls-ready-seed.sql','tests/sql/persona-plan-withdrawal-restore.sql'],'partial':['tests/sql/persona-plan-controls-partial-seed.sql','tests/sql/persona-plan-withdrawal-partial.sql']}
for name,files in cases.items():
 n=1
 while (root/f'{name}-{n}').exists(): n+=1
 data=root/f'{name}-{n}'
 subprocess.run([str(pg/'initdb'),'-D',str(data),'--no-locale','--auth=trust'],stdout=subprocess.DEVNULL,check=True)
 sql='\n\n'.join('\n'.join(l for l in (b/f).read_text().splitlines() if l.strip()) for f in base+files)+'\n\n'
 (root/f'{name}-final.sql').write_text(sql)
 result=subprocess.run([str(pg/'postgres'),'--single','-j','-D',str(data),'postgres'],input=sql,text=True,capture_output=True)
 out=result.stdout+result.stderr;(root/f'{name}-final.log').write_text(out)
 errors=[line for line in out.splitlines() if any(x in line for x in ('ERROR:','FATAL:','WARNING:'))]
 print(name,'result assertions',out.count('assert_ok = '),'errors',errors)
 if result.returncode or errors: raise SystemExit(1)
