#!/usr/bin/env python3
"""Offline atomic six-RPC capability delta. Never connects, installs or activates."""
from pathlib import Path
import hashlib,contextlib,io,runpy,re
R=Path(__file__).resolve().parents[1]
def pinned(path,sha):
 s=(R/path).read_text();assert hashlib.sha256(s.encode()).hexdigest()==sha,path
 return s
pinned('scripts/prepare-scheduler-capability-grant.py','1cc267ee2337afb9f3d23e89f9aaf82d030ac9c63e96e39512860c6af88b0b51')
buffer=io.StringIO()
with contextlib.redirect_stdout(buffer):runpy.run_path(str(R/'scripts/prepare-scheduler-capability-grant.py'))
sql=buffer.getvalue().replace('Three exact wrapper grants.','Six exact wrapper/read grants; supersedes the unexecuted three-wrapper proposal.')
# Exact observed managed Storage proxy. This broadens effective-principal disclosure,
# not live authorization; a new owner approval is required before application.
managed=""" IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin' AND rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolconfig=ARRAY['search_path=storage','log_statement=none']::text[]) THEN RAISE EXCEPTION 'Managed Storage role baseline mismatch'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole OR roleid='supabase_storage_admin'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member='supabase_storage_admin'::regrole AND roleid='authenticator'::regrole AND grantor=(SELECT oid FROM pg_roles WHERE rolname='supabase_admin') AND NOT admin_option AND NOT inherit_option AND set_option) THEN RAISE EXCEPTION 'Managed Storage membership baseline mismatch'; END IF;
 IF NOT pg_has_role('supabase_storage_admin','service_role','SET') OR pg_has_role('supabase_storage_admin','service_role','USAGE') THEN RAISE EXCEPTION 'Managed Storage effective path mismatch'; END IF;
"""
needle=" IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper"
assert sql.count(needle)==1
sql=sql.replace(needle,managed+needle,1)
sql=sql.replace("current_user::regrole,'service_role'::regrole,'authenticator'::regrole)","current_user::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole)")
sql=sql.replace("'character_production_owner'::regrole,'service_role'::regrole,'authenticator'::regrole)","'character_production_owner'::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole)")
queue=pinned('docs/proposals/character-production-enrolled-queues.sql','5dee74d8305f72774e249f951e762fb7de16bf05e2e8aac90771d586b39e2208')
qa=pinned('docs/proposals/character-production-enrolled-qa.sql','b74b0a6de9139aa338a3f900bf68f160f8ea77499107bc8bb33aafd918f6e5de')
extra=[('character_production_scheduler_due','uuid,text,text,integer',queue),('character_production_scheduler_pending','uuid,text,text,integer',queue),('character_production_scheduler_qa_ready','uuid,integer',qa)]
expected='';grants=''
for name,args,source in extra:
 body=re.search(r'CREATE FUNCTION public\.'+name+r'\([^;]+?AS \$\$(.*?)\$\$;',source,re.S).group(1)
 expected+="INSERT INTO cg_expected VALUES('public."+name+'('+args+")',$expected$"+body+'$expected$);\n'
 grants+='GRANT EXECUTE ON FUNCTION public.'+name+'('+args+') TO service_role;\n'
sql=sql.replace('CREATE TEMP TABLE cg_dependencies',expected+'CREATE TEMP TABLE cg_dependencies',1)
sql=sql.replace('CREATE TEMP TABLE cg_after',grants+'CREATE TEMP TABLE cg_after',1)
# Preserve source data and triggers as well as existing ledger/ACL snapshots.
sql=sql.replace('CREATE TEMP TABLE cg_role_attributes',"LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;\nCREATE TEMP TABLE cg_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;\nCREATE TEMP TABLE cg_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;\nCREATE TEMP TABLE cg_role_attributes",1)
needle=" IF EXISTS((SELECT * FROM pg_roles EXCEPT"
checks=""" IF (SELECT count(*) FROM pg_proc WHERE prokind='f')<>(SELECT count(*) FROM cg_functions) THEN RAISE EXCEPTION 'Function set changed'; END IF;
 IF (SELECT count(*) FROM cg_expected)<>6 THEN RAISE EXCEPTION 'Expected exact six capabilities'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM cg_source) UNION ALL (SELECT * FROM cg_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source rows changed'; END IF;
 IF EXISTS(SELECT 1 FROM cg_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.data) OR (SELECT count(*) FROM pg_trigger)<>(SELECT count(*) FROM cg_triggers) THEN RAISE EXCEPTION 'Triggers changed'; END IF;
"""
sql=sql.replace(needle,checks+needle,1)
print(sql,end='')
