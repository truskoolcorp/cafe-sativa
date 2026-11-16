#!/usr/bin/env python3
"""Generate exact-catalog rollback rehearsal only. No database connection or commit mode."""
import argparse,hashlib,importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('catalog_helpers',ROOT/'scripts/prepare-cafe-standing-install.py')
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
SOURCE_SHA='586472ecdfd3fe1775dd9e83ddb0d9943308578a31a009f057de7896e9a64674'
TABLES={'character_production.text_replenishment_budgets','character_production.text_replenishment_attempts'}
RELATIONS=TABLES|{'character_production.text_replenishment_budgets_pkey','character_production.text_replenishment_attempts_pkey','character_production.text_replenishment_attempts_token_key','character_production.text_replenishment_unique_script'}
FUNCTIONS={'character_production_text_claim(text,text,jsonb,uuid,text,integer,integer,text,bigint,integer,integer)','character_production_text_authorized(text,uuid,text,uuid,bigint,integer,integer,integer,integer,text)','character_production_text_save(text,uuid,text,jsonb,text,integer,integer)'}
def validate_delta(before,after):
 b,a=before['catalog'],after['catalog']
 for key in ['roles','members','schemas','defaults','triggers','policies']:
  if b[key]!=a[key]:raise ValueError('Lifecycle/unrelated change: '+key)
 added={}
 for key in ['functions','relations','columns','constraints']:
  if any(x not in a[key] for x in b[key]):raise ValueError('Existing catalog changed: '+key)
  added[key]=[x for x in a[key] if x not in b[key]]
 if {x['identity'].removeprefix('public.') for x in added['functions']}!=FUNCTIONS or len(added['functions'])!=3:raise ValueError('Exactly three text functions required')
 if {x['name'] for x in added['relations']}!=RELATIONS or len(added['relations'])!=6:raise ValueError('Exactly two text tables and four indexes required')
 if any(x['table'] not in RELATIONS for x in added['columns']) or any(x['table'] not in TABLES for x in added['constraints']):raise ValueError('Unrelated columns/constraints')
 if not added['columns'] or not added['constraints']:raise ValueError('Incomplete after contract')
 if any(x['owner']!='character_production_owner' for x in added['functions']+added['relations']):raise ValueError('Restricted owner required')
def generate(before,after):
 validate_delta(before,after)
 source=(ROOT/'docs/proposals/character-production-replenishment.sql').read_text()
 if hashlib.sha256(source.encode()).hexdigest()!=SOURCE_SHA:raise ValueError('Reviewed source changed')
 if not source.rstrip().endswith('ROLLBACK;'):raise ValueError('Unknown source boundary')
 body=source.split('\nBEGIN;',1)[1].rsplit('\nROLLBACK;',1)[0]
 query=(ROOT/'scripts/cafe-standing-catalog.sql').read_text().strip().removesuffix(';')
 def guard(label,m):return "DO $catalog$ DECLARE actual jsonb; BEGIN SELECT manifest INTO actual FROM ("+query+") s; IF actual IS DISTINCT FROM "+helper.quote(json.dumps(m,separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'Reviewed "+label+" mismatch'; END IF; END $catalog$;\n"
 return '''-- REHEARSAL ONLY: exactly text store/three RPCs; no runtime grant or budget rows.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_user<>session_user OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Direct PG17 postgres required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='character_production_owner' AND NOT(rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'Inert owner required'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='character_production_owner'::regrole OR member='character_production_owner'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='character_production_owner'::regrole AND member='postgres'::regrole AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'Exact existing membership required'; END IF;
 IF pg_has_role(current_user,'character_production_owner','SET') OR has_schema_privilege('character_production_owner','public','CREATE') THEN RAISE EXCEPTION 'Unexpected installer authority'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='character_production' AND nspowner='character_production_owner'::regrole) THEN RAISE EXCEPTION 'Existing private schema required'; END IF;
END $$;
'''+guard('before',before)+'''
-- Separate grantor preserves original supabase_admin membership exactly.
GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
'''+body+'''
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM character_production.text_replenishment_budgets) OR EXISTS(SELECT 1 FROM character_production.text_replenishment_attempts) THEN RAISE EXCEPTION 'Activation data forbidden'; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
REVOKE character_production_owner FROM postgres GRANTED BY postgres;
'''+guard('after',after)+'''-- Promotion to commit is a separate review/approval, never a CLI option.
ROLLBACK;
'''
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['before','after','before-sha256','after-sha256']:p.add_argument('--'+name,required=True)
 a=p.parse_args();print(generate(helper.load_manifest(a.before,a.before_sha256),helper.load_manifest(a.after,a.after_sha256)))
if __name__=='__main__':main()
