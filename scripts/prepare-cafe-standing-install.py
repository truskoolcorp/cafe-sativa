#!/usr/bin/env python3
"""Prepare rollback-only installer rehearsal. Never connects to or mutates a database.

An exact reviewed before/after catalog contract is mandatory. Live installation is
intentionally unavailable: a separate reviewed promotion must replace ROLLBACK.
"""
import argparse, hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCES={
 'cafe-standing-publication-authority.sql':'0a393021569adc186c2d03ade8ba89c728c45480ec1cdf1840b5e3b51ad410c5',
 'cafe-semantic-budget.sql':'a5fff9aeb1be44c8a6bdb6f7d67e08e347caa034e31ba631f1f90d8c4358b93c'}

def load_manifest(path,digest):
 raw=Path(path).read_bytes()
 if len(digest)!=64 or hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Reviewed manifest digest mismatch')
 m=json.loads(raw)
 if not isinstance(m,dict) or set(m)!={'format','catalog'} or m['format']!='cafe-standing-catalog-v1' or not isinstance(m['catalog'],dict):raise ValueError('Exact catalog envelope required')
 if set(m['catalog'])!={'roles','members','schemas','functions','relations','columns','constraints','triggers','policies','defaults'}:raise ValueError('Complete catalog required')
 if any(not isinstance(v,list) for v in m['catalog'].values()) or not all(m['catalog'][k] for k in ['roles','members','schemas','functions','relations','columns']):raise ValueError('Empty or malformed baseline')
 return m

def quote(s):return "'"+s.replace("'","''")+"'"
def generate(before,after):
 # Lifecycle and all existing grants must be accounted for in separately reviewed
 # manifests. These sets must be identical even if a proposed after was mistaken.
 for key in ['roles','members','schemas','defaults']:
  if before['catalog'][key]!=after['catalog'][key]:raise ValueError('Persistent lifecycle expansion forbidden: '+key)
 if before==after:raise ValueError('Expected changed contract required')
 query=(ROOT/'scripts/cafe-standing-catalog.sql').read_text().strip().removesuffix(';')
 guards=[]
 for label,m in [('before',before),('after',after)]:
  guards.append("DO $guard$ DECLARE actual jsonb; BEGIN SELECT manifest INTO actual FROM ("+query+") snapshot; IF actual IS DISTINCT FROM "+quote(json.dumps(m,separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'Exact reviewed "+label+" catalog mismatch'; END IF; END $guard$;\n")
 bodies=[]
 for file,digest in SOURCES.items():
  src=(ROOT/'docs/proposals'/file).read_text()
  if hashlib.sha256(src.encode()).hexdigest()!=digest:raise ValueError('Reviewed source changed: '+file)
  body=src.split('\nBEGIN;',1)[1]
  if not (body.rstrip().endswith('COMMIT;') or body.rstrip().endswith('ROLLBACK;')):raise ValueError('Unknown transaction boundary')
  bodies.append(body[:body.rfind('\nCOMMIT;') if '\nCOMMIT;' in body else body.rfind('\nROLLBACK;')])
 return '''-- REHEARSAL ONLY. No runtime grants, credentials, budget, scope or activation.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_user<>session_user OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Direct PG17 postgres required'; END IF;
END $$;
'''+guards[0]+'''
-- Temporary installer capability, always restored before after-manifest check.
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT cafe_metricool_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner,cafe_metricool_owner;
'''+ '\nRESET ROLE;\n'.join(bodies)+'''
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner,cafe_metricool_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cafe_metricool_private.publication_scopes) OR EXISTS(SELECT 1 FROM cafe_metricool_private.publication_binding) OR EXISTS(SELECT 1 FROM cafe_metricool_private.publication_authorities) OR EXISTS(SELECT 1 FROM cafe_metricool_private.semantic_budgets) OR EXISTS(SELECT 1 FROM cafe_metricool_private.semantic_attempts) THEN RAISE EXCEPTION 'Unexpected activation data'; END IF;
END $$;
'''+guards[1]+'''-- Deliberately no commit mode. Review actual live baseline and approval first.
ROLLBACK;
'''

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['before','after','before-sha256','after-sha256']:p.add_argument('--'+name,required=True)
 a=p.parse_args();print(generate(load_manifest(a.before,a.before_sha256),load_manifest(a.after,a.after_sha256)))
if __name__=='__main__':main()
