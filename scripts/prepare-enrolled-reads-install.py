#!/usr/bin/env python3
"""Offline only: deterministic owner-only scoped read installer. Never applies SQL."""
from pathlib import Path
import contextlib,hashlib,io,re,runpy
R=Path(__file__).resolve().parents[1]
def pinned(path,sha):
 s=(R/path).read_text();assert hashlib.sha256(s.encode()).hexdigest()==sha,path
 return s
# Reuse the exact reviewed restricted-owner bootstrap and catalog preservation code.
pinned('scripts/prepare-scheduler-principal-install.py','d4d5be1fd5e6567b2d9fb2c34759c7a205f99b66cbbc94e16b5af114c862144b')
with contextlib.redirect_stdout(io.StringIO()): old=runpy.run_path(str(R/'scripts/prepare-scheduler-principal-install.py'))
queue=pinned('docs/proposals/character-production-enrolled-queues.sql','5dee74d8305f72774e249f951e762fb7de16bf05e2e8aac90771d586b39e2208')
qa=pinned('docs/proposals/character-production-enrolled-qa.sql','b74b0a6de9139aa338a3f900bf68f160f8ea77499107bc8bb33aafd918f6e5de')
principal=pinned('docs/proposals/character-production-scheduler-principal.sql','cec0ff48b82eedcbd342f13339457d561fb4abfc84dbe58bf05c106c59b49da5')
wallet=pinned('docs/proposals/character-production-heygen-budget-install.sql','a73fafbf250b47e1125960b2aa067a990c23c78ad0c7d251c3e1008943a53921')
recurring=pinned('docs/proposals/character-production-qa-recurring-install.sql','8cbc9f4612c934f6e9f7488722c8e4c831a16f0ffa633f92be18c29df427c16c')
store=pinned('docs/proposals/character-production-store.sql','2c858dabefdfaf67c9bf2fa7189503aaa7a55d27b1e1eb710b27365268881ca9')
def body(s):return s.split('\nBEGIN;',1)[1].rsplit('\nCOMMIT;',1)[0]
def quote(s):return "'"+s.replace("'","''")+"'"
def function(s,name):
 m=re.search(r'CREATE(?: OR REPLACE)? FUNCTION '+re.escape(name)+r'\([^;]*?AS \$\$(.*?)\$\$;',s,re.S)
 assert m,name
 return m.group(1)
pre=old['pre']
pre=pre.replace('Empty scheduler principal, no runtime grants/rows/activation.','Three owner-only scoped reads, no runtime grants/rows/activation.')
# Existing principal is now prerequisite, not a new installation target.
line=next(x for x in pre.splitlines() if "Scheduler principal already exists: reconcile" in x)
pre=pre.replace(line," IF (SELECT count(*) FROM pg_class WHERE relnamespace='character_production'::regnamespace AND relname IN ('scheduler_enrollments','scheduler_candidates','scheduler_binding') AND relowner='character_production_owner'::regrole AND relrowsecurity AND NOT relforcerowsecurity)<>3 THEN RAISE EXCEPTION 'Principal tables missing or changed'; END IF;\n IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace) AND proname IN ('character_production_scheduler_due','character_production_scheduler_pending','character_production_scheduler_qa_ready')) THEN RAISE EXCEPTION 'Scoped reads already exist: reconcile'; END IF;")
checks='DO $$ DECLARE f pg_proc; own oid:=\'character_production_owner\'::regrole; extra oid; BEGIN\n'
for source,name,sig,sec,extra in [
 (principal,'character_production.scheduler_current','uuid',True,False),
 (wallet,'character_production.calendar_period','text,timestamptz',False,False),
 (wallet,'public.character_production_due','text,text,integer',True,True),
 (store,'public.character_production_pending','text,text,integer',True,True),
 (recurring,'public.character_production_qa_ready_slots','integer',True,True),
 (recurring,'public.character_production_qa_materialize','text,text',True,True)]:
 schema,proname=name.split('.')
 argtypes=' '.join({'uuid':'2950','text':'25','integer':'23','timestamptz':'1184'}[t] for t in sig.split(','))
 checks+=" SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname="+quote(schema)+" AND p.proname="+quote(proname)+" AND p.proargtypes="+quote(argtypes)+"::oidvector;\n IF NOT FOUND OR f.proowner<>own OR f.prosecdef IS DISTINCT FROM "+str(sec).lower()+" OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM "+quote(function(source,name))+" THEN RAISE EXCEPTION 'Dependency definition mismatch: "+name+"'; END IF;\n"
 checks+=" extra:="+("'service_role'::regrole" if extra else 'NULL')+";\n IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT own,extra,'EXECUTE',false WHERE extra IS NOT NULL) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency ACL mismatch'; END IF;\n"
checks+=" SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.character_production_qa_draft_unplanned(uuid)');\n IF NOT FOUND OR f.proowner<>current_user::regrole OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR f.prosrc IS DISTINCT FROM "+quote(function(recurring,'public.character_production_qa_draft_unplanned'))+" THEN RAISE EXCEPTION 'Source-owned unplanned dependency mismatch'; END IF;\n IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))), e AS (SELECT f.proowner grantor,f.proowner grantee,'EXECUTE'::text privilege_type,false is_grantable UNION ALL SELECT f.proowner,own,'EXECUTE',false) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Source-owned unplanned ACL mismatch'; END IF;\n"
checks+='END $$;\n'
pre=pre.replace('LOCK TABLE public.cs_character_promo_drafts',checks+'LOCK TABLE public.cs_character_promo_drafts',1)
# Owner-only functions add no tables or rows. Preserve ALL existing rows.
post=old['post']
post=post.replace(" IF EXISTS(SELECT 1 FROM character_production.scheduler_enrollments) OR EXISTS(SELECT 1 FROM character_production.scheduler_candidates) OR EXISTS(SELECT 1 FROM character_production.scheduler_binding) THEN RAISE EXCEPTION 'Scheduler must install empty'; END IF;\n",'')
post=post.replace(" AND relname NOT IN ('scheduler_enrollments','scheduler_candidates','scheduler_binding')",'')
a=post.index(' FOR new_table_row IN');b=post.index(" IF pg_has_role(current_user",a)
new=''
for name,args,src in [('character_production_scheduler_due','uuid,text,text,integer',queue),('character_production_scheduler_pending','uuid,text,text,integer',queue),('character_production_scheduler_qa_ready','uuid,integer',qa)]:
 new+=" SELECT * INTO new_function_row FROM pg_proc WHERE oid=to_regprocedure('public."+name+'('+args+")');\n IF NOT FOUND OR new_function_row.proowner<>own OR NOT new_function_row.prosecdef OR new_function_row.prorettype<>'jsonb'::regtype OR new_function_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR new_function_row.prosrc IS DISTINCT FROM "+quote(function(src,'public.'+name))+" THEN RAISE EXCEPTION 'Scoped function identity mismatch'; END IF;\n IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(new_function_row.proacl,acldefault('f',own)))), e AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM e) UNION ALL (SELECT * FROM e EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Scoped function ACL mismatch'; END IF;\n"
new+=" IF (SELECT count(*) FROM pg_proc p WHERE NOT EXISTS(SELECT 1 FROM si_functions b WHERE b.oid=p.oid) AND p.pronamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace))<>3 THEN RAISE EXCEPTION 'Unexpected new functions'; END IF;\n IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace,'character_production'::regnamespace,'auth'::regnamespace) AND NOT EXISTS(SELECT 1 FROM si_objects b WHERE b.oid=c.oid)) THEN RAISE EXCEPTION 'Unexpected new relation'; END IF;\n IF (SELECT count(*) FROM pg_trigger)<>(SELECT count(*) FROM si_triggers) THEN RAISE EXCEPTION 'Triggers changed'; END IF;\n"
post=post[:a]+new+post[b:]
# Preserve role attributes as well as grants (catalog read only).
pre=pre.replace('CREATE TEMP TABLE si_defaults','CREATE TEMP TABLE si_roles ON COMMIT DROP AS SELECT * FROM pg_roles;\nCREATE TEMP TABLE si_defaults',1)
post=post.replace(" IF EXISTS((SELECT * FROM pg_default_acl", " IF EXISTS((SELECT * FROM pg_roles EXCEPT SELECT * FROM si_roles) UNION ALL (SELECT * FROM si_roles EXCEPT SELECT * FROM pg_roles)) THEN RAISE EXCEPTION 'Role attributes changed'; END IF;\n IF EXISTS((SELECT * FROM pg_default_acl",1)
print(pre+body(queue)+body(qa)+post)
