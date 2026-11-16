#!/usr/bin/env python3
"""Isolated PG17 owner-role rehearsal. No live catalogs, keys or production data."""
import importlib.util,json,os,re,subprocess
import validate_ledger as db
spec=importlib.util.spec_from_file_location('text_installer',db.ROOT/'scripts/prepare-character-text-install.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
CATALOG=(db.ROOT/'scripts/cafe-standing-catalog.sql').read_text()
def run(sql):
 p=subprocess.run(db.command(),input=sql,text=True,capture_output=True,timeout=60);db.LOG.append(p.stdout+p.stderr)
 if p.returncode or re.search(r'ERROR:|FATAL:|PANIC:',p.stderr):raise RuntimeError(p.stdout+p.stderr)
 return p.stdout.strip()
def capture():return json.loads(run('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; '+CATALOG+' ROLLBACK;'))
def fails(sql,label):
 p=subprocess.run(db.command(),input=sql,text=True,capture_output=True,timeout=60);db.LOG.append(p.stdout+p.stderr)
 assert p.returncode and label in p.stderr,(label,p.stdout,p.stderr)
def main():
 assert os.environ.get('PG_DISPOSABLE_TEST_CONFIRM')=='yes' and os.environ.get('PG_TEST_SERVER')=='1'
 assert os.environ.get('PGHOST') in ['127.0.0.1','localhost','::1']
 assert os.environ.get('PGUSER')=='ci_bootstrap'
 run("""DO $$ BEGIN IF current_user<>'ci_bootstrap' OR current_user<>session_user OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres') OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR to_regnamespace('character_production') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN RAISE EXCEPTION 'Fresh isolated PG17 required'; END IF; END $$;
 -- Bootstrap stays superuser. Rehearsal uses a separate genuine login session.
 CREATE ROLE postgres LOGIN NOSUPERUSER INHERIT CREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-ci-only';
 DO $$ BEGIN EXECUTE format('ALTER DATABASE %I OWNER TO postgres',current_database()); END $$;
 CREATE ROLE supabase_admin SUPERUSER NOLOGIN;
 CREATE ROLE character_production_owner NOLOGIN NOINHERIT;
 CREATE ROLE service_role NOLOGIN INHERIT BYPASSRLS;
 CREATE ROLE authenticator LOGIN NOINHERIT;
 CREATE ROLE supabase_storage_admin LOGIN NOINHERIT;
 CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE SCHEMA character_production AUTHORIZATION character_production_owner;
 SET ROLE supabase_admin;
 GRANT character_production_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE;
 GRANT service_role TO postgres WITH ADMIN TRUE,INHERIT TRUE,SET TRUE;
 GRANT service_role TO authenticator WITH ADMIN FALSE,INHERIT FALSE,SET TRUE;
 GRANT authenticator TO supabase_storage_admin WITH ADMIN FALSE,INHERIT FALSE,SET TRUE;
 ALTER DEFAULT PRIVILEGES FOR ROLE character_production_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
 RESET ROLE;
 REVOKE CREATE ON SCHEMA public FROM PUBLIC;
 GRANT USAGE ON SCHEMA public TO character_production_owner,service_role,anon,authenticated;
 """)
 os.environ['PGUSER']='postgres'
 assert run("SELECT current_user='postgres' AND session_user='postgres' AND NOT rolsuper AND rolcreaterole FROM pg_roles WHERE rolname=current_user;")=='t'
 before=capture()
 source=(db.ROOT/'docs/proposals/character-production-replenishment.sql').read_text()
 body=source.split('\nBEGIN;',1)[1].rsplit('\nROLLBACK;',1)[0]
 # Collect exact expected after in disposable transaction, never persist it.
 collection="""BEGIN; SET LOCAL search_path=pg_catalog;
 GRANT character_production_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
 GRANT CREATE ON SCHEMA public TO character_production_owner;
 SET LOCAL ROLE character_production_owner;
 """+body+"""
 RESET ROLE;
 REVOKE CREATE ON SCHEMA public FROM character_production_owner;
 REVOKE character_production_owner FROM postgres GRANTED BY postgres;
 """+CATALOG+'\nROLLBACK;'
 after=json.loads(run(collection));assert after!=before and capture()==before
 sql=installer.generate(before,after)
 run(sql);assert capture()==before,'rollback must exactly preserve full catalog'
 assert json.loads(run(collection))==after,'repeat derivation must be stable'
 # Drift, incomplete restoration, unapproved grant and interrupted work all fail.
 fails(sql.replace('BEGIN;','BEGIN; GRANT CREATE ON SCHEMA public TO service_role;',1),'Reviewed before mismatch')
 assert capture()==before
 fails(sql.replace('REVOKE CREATE ON SCHEMA public FROM character_production_owner;','-- injected missing cleanup'),'Reviewed after mismatch')
 assert capture()==before
 fails(sql.replace('RESET ROLE;','GRANT EXECUTE ON FUNCTION public.character_production_text_authorized(text,uuid,text,uuid,bigint,integer,integer,integer,integer,text) TO service_role; RESET ROLE;',1),'Reviewed after mismatch')
 assert capture()==before
 fails(sql.replace('-- Promotion to commit',"DO $$ BEGIN RAISE EXCEPTION 'injected abort'; END $$;\n-- Promotion to commit"),'injected abort')
 assert capture()==before
 assert run("SELECT NOT pg_has_role('postgres','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE') AND to_regclass('character_production.text_replenishment_budgets') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname LIKE 'character_production_text_%');")=='t'
 db.finish('character-text-installer')
if __name__=='__main__':main()
