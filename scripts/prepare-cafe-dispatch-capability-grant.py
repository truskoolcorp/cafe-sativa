#!/usr/bin/env python3
"""Offline dispatch-only four RPC grant. Writer remains owner-only. Never execute."""
from pathlib import Path
import ast,hashlib,json
R=Path(__file__).resolve().parents[1]
def pinned(p,h):
 s=(R/p).read_text();assert hashlib.sha256(s.encode()).hexdigest()==h,p;return s
s=pinned('scripts/prepare-scheduler-capability-grant.py','1cc267ee2337afb9f3d23e89f9aaf82d030ac9c63e96e39512860c6af88b0b51')
e=pinned('scripts/prepare-enrolled-runtime-capability-grant.py','6a786253b533b383f6f262cf5b33c4f2698054307f7d30f467938294628ec6ed')
# Reuse exact reviewed topology/catalog-restoration blocks, not scheduler behavior.
chunks=[n.value.args[0].value for n in ast.parse(s).body if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='print' and isinstance(n.value.args[0],ast.Constant)]
assert len(chunks)==5
managed=next(n.value.value for n in ast.parse(e).body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='managed' for t in n.targets))
map_sql=lambda s:s.replace('character_production_owner','cafe_metricool_owner').replace('character_production.%I','cafe_metricool_private.%I').replace("'character_production'::regnamespace","'cafe_metricool_private'::regnamespace")
pre=map_sql(chunks[0]).replace('Three exact wrapper grants.','Four Café dispatch grants only. Authority writer remains owner-only.')
# Prospective hardening: provider identity is fixed, not any matching non-self grantor.
bootstrap="grantor<>current_user::regrole AND admin_option AND NOT inherit_option AND NOT set_option"
assert pre.count(bootstrap)==1
pre=pre.replace(bootstrap,"grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option")
pre=pre.replace(" IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper",managed+" IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper",1)
pre=pre.replace("current_user::regrole,'service_role'::regrole,'authenticator'::regrole)","current_user::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole)")
rows=json.loads((R/'tests/sql/cafe-capability-installed-baseline.json').read_text());assert len(rows)==10
q=lambda x:"'"+x.replace("'","''")+"'"
pre+='CREATE TEMP TABLE cd_dependencies(nsp text,name text,definition text,owner_name text) ON COMMIT DROP;\nINSERT INTO cd_dependencies VALUES '+','.join('('+','.join(map(q,[r['nspname'],r['proname'],r['definition'],r['owner']]))+')' for r in rows)+';\n'
pre+=r'''DO $$ DECLARE e record; f record; own oid:='cafe_metricool_owner'::regrole; BEGIN
 FOR e IN SELECT * FROM cd_dependencies LOOP
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=e.nsp AND p.proname=e.name)<>1 THEN RAISE EXCEPTION 'Dependency missing/overloaded %',e.name; END IF;
 SELECT p.* INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=e.nsp AND p.proname=e.name;
 IF pg_get_functiondef(f.oid) IS DISTINCT FROM e.definition OR f.proowner<>e.owner_name::regrole THEN RAISE EXCEPTION 'Dependency definition mismatch %',e.name; END IF;
 IF e.name='cs_cafe_metricool_is_admin' THEN
 IF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))), b AS (SELECT current_user::regrole::oid grantor,x::regrole::oid grantee,'EXECUTE'::text privilege_type,false is_grantable FROM unnest(ARRAY[current_user::text,'character_production_owner','cafe_metricool_owner']) x) (SELECT * FROM a EXCEPT SELECT * FROM b) UNION ALL (SELECT * FROM b EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Bridge ACL mismatch'; END IF;
 ELSIF EXISTS(WITH a AS (SELECT * FROM aclexplode(coalesce(f.proacl,acldefault('f',own)))), b AS (SELECT own grantor,own grantee,'EXECUTE'::text privilege_type,false is_grantable) (SELECT * FROM a EXCEPT SELECT * FROM b) UNION ALL (SELECT * FROM b EXCEPT SELECT * FROM a)) THEN RAISE EXCEPTION 'Dependency baseline ACL mismatch %',e.name; END IF;
 END LOOP;
END $$;
'''
sigs=['cs_preflight_cafe_metricool(uuid,text)','cs_claim_cafe_metricool(uuid,text,text,text)','cs_identity_cafe_metricool(uuid,uuid,text,text)','cs_finish_cafe_metricool(uuid,uuid,text,jsonb)']
for sig in sigs:pre+='INSERT INTO cg_expected VALUES('+q('public.'+sig)+",'unused; exact full dependency pinned above');\n"
snap=map_sql('CREATE TEMP TABLE cg_role_attributes'+chunks[3].split('CREATE TEMP TABLE cg_role_attributes',1)[1])
snap="LOCK TABLE public.cs_character_promo_drafts,public.cs_character_promo_delivery_plans,public.cs_character_promo_qa_checks IN SHARE MODE;\nCREATE TEMP TABLE cd_source ON COMMIT DROP AS SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x;\nCREATE TEMP TABLE cd_triggers ON COMMIT DROP AS SELECT oid,to_jsonb(t) data FROM pg_trigger t;\n"+snap
grants=''.join('GRANT EXECUTE ON FUNCTION public.'+sig+' TO service_role;\n' for sig in sigs)
post=map_sql(chunks[4]).replace("'cafe_metricool_owner'::regrole,'service_role'::regrole,'authenticator'::regrole)","'cafe_metricool_owner'::regrole,'service_role'::regrole,'authenticator'::regrole,'supabase_storage_admin'::regrole)")
checks=r''' IF (SELECT count(*) FROM pg_proc WHERE prokind='f')<>(SELECT count(*) FROM cg_functions) OR (SELECT count(*) FROM cg_expected)<>4 THEN RAISE EXCEPTION 'Function set changed'; END IF;
 IF EXISTS(WITH actual AS (SELECT 'drafts' name,to_jsonb(x) data FROM public.cs_character_promo_drafts x UNION ALL SELECT 'plans',to_jsonb(x) FROM public.cs_character_promo_delivery_plans x UNION ALL SELECT 'qa',to_jsonb(x) FROM public.cs_character_promo_qa_checks x) (SELECT * FROM actual EXCEPT ALL SELECT * FROM cd_source) UNION ALL (SELECT * FROM cd_source EXCEPT ALL SELECT * FROM actual)) THEN RAISE EXCEPTION 'Source data changed'; END IF;
 IF EXISTS(SELECT 1 FROM cd_triggers b LEFT JOIN pg_trigger t USING(oid) WHERE b.data IS DISTINCT FROM to_jsonb(t)) OR (SELECT count(*) FROM pg_trigger)<>(SELECT count(*) FROM cd_triggers) THEN RAISE EXCEPTION 'Triggers changed'; END IF;
 IF has_function_privilege('service_role','public.cs_record_cafe_metricool_authority(uuid,jsonb,text,text,text,jsonb,uuid,timestamptz,timestamptz,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Writer boundary crossed'; END IF;
'''
post=post.replace(' IF EXISTS((SELECT * FROM pg_roles EXCEPT',checks+' IF EXISTS((SELECT * FROM pg_roles EXCEPT',1)
print(pre+snap+grants+post,end='')

