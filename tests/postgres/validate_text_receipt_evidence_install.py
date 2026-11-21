"""Disposable PG17 rehearsal of exact metadata-only installer. No live execution."""
import validate_ledger as db
SIG='public.character_production_text_receipt(text,uuid,text,text,text,text,text,integer,integer,text)'
def suite():
 db.check("to_regnamespace('character_production') IS NULL",'fresh isolated cluster required')
 db.run("CREATE ROLE postgres LOGIN CREATEROLE NOSUPERUSER NOINHERIT; CREATE ROLE character_production_owner NOLOGIN NOSUPERUSER NOINHERIT; CREATE ROLE service_role NOLOGIN INHERIT BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE authenticator LOGIN NOINHERIT; CREATE ROLE supabase_storage_admin LOGIN NOINHERIT CREATEROLE; ALTER ROLE supabase_storage_admin SET search_path=storage; ALTER ROLE supabase_storage_admin SET log_statement=none; GRANT service_role TO postgres WITH ADMIN TRUE,INHERIT TRUE,SET TRUE GRANTED BY supabase_admin; GRANT service_role TO authenticator WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY supabase_admin; GRANT authenticator TO supabase_storage_admin WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY supabase_admin; CREATE SCHEMA character_production AUTHORIZATION character_production_owner; GRANT CREATE ON SCHEMA public TO postgres WITH GRANT OPTION; GRANT CREATE ON SCHEMA public TO character_production_owner;")
 src=(db.ROOT/'docs/proposals/character-production-replenishment.sql').read_text()
 db.run('SET ROLE character_production_owner; '+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.run("REVOKE CREATE ON SCHEMA public FROM character_production_owner; GRANT character_production_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;")
 src=(db.ROOT/'docs/proposals/character-production-text-receipt-evidence-install.sql').read_text();prefix='SET SESSION AUTHORIZATION postgres; '
 db.run(prefix+src)
 db.check("to_regclass('character_production.text_receipt_evidence') IS NULL",'default rollback no objects')
 db.check("NOT pg_has_role('postgres','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'rollback temporary privileges absent')
 # An added indirect principal must abort before modifying security or objects.
 try:db.run("BEGIN; CREATE ROLE unexpected_receipt_principal; GRANT authenticator TO unexpected_receipt_principal WITH INHERIT FALSE,SET TRUE; "+prefix+src)
 except RuntimeError as e:assert 'Unexpected effective service principal' in str(e)
 else:raise AssertionError('expanded graph accepted')
 db.check("NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='unexpected_receipt_principal')",'denied graph transaction rolled back')
 db.run(prefix+src.rsplit('ROLLBACK;',1)[0]+'COMMIT;')
 db.check("NOT pg_has_role('postgres','character_production_owner','SET') AND NOT has_schema_privilege('character_production_owner','public','CREATE')",'commit temporary privileges absent')
 for role in ['service_role','postgres']:
  db.check('has_function_privilege('+db.quote(role)+','+db.quote(SIG)+",'EXECUTE')",'expected inherited receipt access')
 for role in ['authenticator','supabase_storage_admin']:
  db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote(SIG)+",'EXECUTE') AND pg_has_role("+db.quote(role)+",'service_role','SET')",'reviewed indirect SET path only')
 for role in ['anon','authenticated','service_role','authenticator','supabase_storage_admin']:
  db.check('NOT has_table_privilege('+db.quote(role)+",'character_production.text_receipt_evidence','SELECT,INSERT,UPDATE,DELETE')",'no direct data capability')
 for role in ['anon','authenticated']:
  db.check('NOT has_function_privilege('+db.quote(role)+','+db.quote(SIG)+",'EXECUTE')",'no public API capability')
 try:db.run(prefix+src)
 except RuntimeError as e:assert 'Receipt capability already installed' in str(e)
 else:raise AssertionError('repeat installation accepted')
 db.check("(SELECT count(*)=0 FROM character_production.text_receipt_evidence) AND (SELECT count(*)=0 FROM character_production.text_replenishment_attempts) AND (SELECT count(*)=0 FROM character_production.text_replenishment_budgets)",'no authority, claim or receipt fabricated')
 db.run("SET ROLE service_role; DO $$ BEGIN IF public.character_production_text_receipt(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) IS DISTINCT FROM false THEN RAISE EXCEPTION 'read-only availability probe mismatch'; END IF; END $$;")
 db.check("(SELECT count(*)=0 FROM character_production.text_receipt_evidence)",'availability probe writes nothing')
 # Demonstrate non-destructive operational rollback without persisting it.
 db.run("BEGIN; SET ROLE character_production_owner; REVOKE EXECUTE ON FUNCTION "+SIG+" FROM service_role; RESET ROLE; DO $$ BEGIN IF has_function_privilege('service_role',"+db.quote(SIG)+",'EXECUTE') THEN RAISE EXCEPTION 'receipt revoke failed'; END IF; END $$; ROLLBACK;")
 db.finish('text-receipt-evidence-install')
if __name__=='__main__':suite()
