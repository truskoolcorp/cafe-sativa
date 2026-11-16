#!/usr/bin/env python3
"""Fresh single-user PostgreSQL fixture. No sockets or production connections."""
from pathlib import Path
import argparse,subprocess
p=argparse.ArgumentParser();p.add_argument('--pg-bin',required=True);p.add_argument('--case');args=p.parse_args()
b=Path(__file__).resolve().parents[2];pg=Path(args.pg_bin);root=b/'.local-pg-dispatch';root.mkdir(exist_ok=True)
files=['tests/sql/persona-ledger-fixture.sql','supabase/migrations/20261020154000_character_canon_spoken_promos.sql','supabase/migrations/20261020173000_character_promo_qa_checks.sql','supabase/migrations/20261021103000_decouple_promo_script_approval_from_audio.sql','docs/proposals/persona-delivery-ledger.sql','tests/sql/persona-gates-seed.sql','docs/proposals/persona-approval-gates.sql','docs/proposals/persona-owner-revocation.sql','docs/proposals/persona-plan-authoring.sql','docs/proposals/persona-plan-withdrawal.sql','docs/proposals/persona-dispatch-owner.sql','tests/sql/persona-dispatch-ready-seed.sql','tests/sql/persona-dispatch-owner-tests.sql']
cases={'owner':files,'precision':files[:-2]+['tests/sql/persona-dispatch-precision-seed.sql','tests/sql/persona-dispatch-precision-tests.sql'],'cohort-time':files[:-2]+['tests/sql/persona-dispatch-cohort-time-seed.sql','tests/sql/persona-dispatch-cohort-time-tests.sql'],'fold-first':files[:-2]+['tests/sql/persona-dispatch-fold-first-seed.sql','tests/sql/persona-dispatch-fold-reject.sql'],'fold-second':files[:-2]+['tests/sql/persona-dispatch-fold-second-seed.sql','tests/sql/persona-dispatch-fold-reject.sql'],'fold-nearby':files[:-2]+['tests/sql/persona-dispatch-fold-nearby-seed.sql','tests/sql/persona-dispatch-fold-allow.sql'],'expiry':files[:-2]+['tests/sql/persona-dispatch-expiry-seed.sql','tests/sql/persona-dispatch-expiry-tests.sql']}
cases['null-schedule']=files[:-2]+['tests/sql/persona-production-schedule-overlay.sql','tests/sql/persona-null-schedule-tests.sql']
cases['generation-match']=files[:-2]+['tests/sql/persona-generation-match-tests.sql']
cases['generation-match-base']=[f for f in files[:-2] if f not in ('docs/proposals/persona-plan-withdrawal.sql','docs/proposals/persona-dispatch-owner.sql')]+['tests/sql/persona-generation-match-tests.sql']
for name,case in cases.items():
 if args.case and name!=args.case:continue
 n=1
 while (root/f'{name}-{n}').exists():n+=1
 data=root/f'{name}-{n}'
 subprocess.run([str(pg/'initdb'),'-D',str(data),'--no-locale','--auth=trust'],stdout=subprocess.DEVNULL,check=True)
 sql='\n\n'.join('\n'.join(l for l in (b/f).read_text().splitlines() if l.strip()) for f in case)+'\n\n'
 (root/f'{name}-final.sql').write_text(sql)
 r=subprocess.run([str(pg/'postgres'),'--single','-j','-D',str(data),'postgres'],input=sql,text=True,capture_output=True)
 out=r.stdout+r.stderr;(root/f'{name}-final.log').write_text(out)
 errors=[l for l in out.splitlines() if any(x in l for x in ('ERROR:','FATAL:','WARNING:'))]
 print(name,'result assertions:',out.count('assert_ok = '),'Errors:',errors,flush=True)
 if r.returncode or errors:raise SystemExit(1)

 if name=='null-schedule':
  line=next(l for l in out.splitlines() if 'boundary_export = "' in l)
  export=root/'null-schedule-boundary.json'
  export.write_text(line.split('boundary_export = "',1)[1].rsplit('"',1)[0])
  subprocess.run(['node','tests/sql/persona-null-schedule-reader.cjs',str(export)],cwd=b,check=True)
