#!/usr/bin/env python3
"""Offline commit-capable promotion. Does not connect or execute SQL.

Requires separate exact-action authorization and independent review outside this
program. References are evidence pointers, not proof of consent. No runtime grants,
policy/enrollment, model allowance or provider invocation are introduced.
"""
import argparse,datetime,hashlib,importlib.util,os,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
INSTALLER=ROOT/'scripts/prepare-cafe-standing-install.py'
INSTALLER_SHA='13b87bb728cdb7ee63fee641f51b1080afcbb3e934eaafcbb8947a00d81568bc'

def module():
 if hashlib.sha256(INSTALLER.read_bytes()).hexdigest()!=INSTALLER_SHA:raise ValueError('Reviewed rehearsal generator changed')
 spec=importlib.util.spec_from_file_location('rehearsal',INSTALLER)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

def promote(before,after,rehearsal_sha,approval_reference,review_reference,expires_at,now=None):
 now=now or datetime.datetime.now(datetime.timezone.utc)
 if now.tzinfo is None:raise ValueError('UTC-aware time required')
 for ref in [approval_reference,review_reference]:
  if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,200}',ref):raise ValueError('Bounded evidence reference required')
 try:expiry=datetime.datetime.fromisoformat(expires_at.replace('Z','+00:00'))
 except ValueError:raise ValueError('Valid expiry required') from None
 if expiry.tzinfo is None or not now<expiry<=now+datetime.timedelta(minutes=30):raise ValueError('Execution window must be future and at most 30 minutes')
 m=module();sql=m.generate(before,after)
 if not re.fullmatch('[a-f0-9]{64}',rehearsal_sha) or hashlib.sha256(sql.encode()).hexdigest()!=rehearsal_sha:raise ValueError('Exact reviewed rehearsal digest required')
 ending='-- Deliberately no commit mode. Review actual live baseline and approval first.\nROLLBACK;\n'
 if not sql.endswith(ending) or sql.count('\nROLLBACK;')!=1 or '\nCOMMIT;' in sql:raise ValueError('Unexpected rehearsal boundary')
 expiry_text=expiry.astimezone(datetime.timezone.utc).isoformat()
 guard="DO $window$ BEGIN IF clock_timestamp()>="+m.quote(expiry_text)+"::timestamptz THEN RAISE EXCEPTION 'Promotion execution window expired'; END IF; END $window$;\n"
 # Preserve every catalog, empty-table and temporary-lifecycle check byte-for-byte.
 body=sql[:-len(ending)].replace('-- REHEARSAL ONLY. No runtime grants, credentials, budget, scope or activation.', '-- Exact reviewed owner-only contract. No runtime grants, budget, scope or activation.',1).replace('BEGIN;\n','BEGIN;\n'+guard,1)
 return '-- COMMIT-CAPABLE OWNER-ONLY CONTRACT INSTALL; separate action approval required.\n-- Approval reference: '+approval_reference+'\n-- Review reference: '+review_reference+'\n-- Rehearsal SHA256: '+rehearsal_sha+'\n'+body+guard+'COMMIT;\n'

def write_private(path,sql):
 path=Path(path).resolve()
 if path==ROOT or ROOT in path.parents:raise ValueError('Private output must be outside repository')
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(sql)
 return hashlib.sha256(sql.encode()).hexdigest()

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['before','after','before-sha256','after-sha256','rehearsal-sha256','approval-reference','review-reference','expires-at','output']:p.add_argument('--'+k,required=True)
 a=p.parse_args();m=module()
 sql=promote(m.load_manifest(a.before,a.before_sha256),m.load_manifest(a.after,a.after_sha256),a.rehearsal_sha256,a.approval_reference,a.review_reference,a.expires_at)
 print('prepared_not_executed_sha256='+write_private(a.output,sql))
if __name__=='__main__':main()
