/** OFFLINE ONLY: produce review SQL; never executes or connects. QA excluded. */
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const sources=['character-production-store.sql','character-production-queue.sql','character-production-broker-authorization.sql']
export const generatorSignatures=['authorization(text,text)','claim(jsonb,text)','submitted(text,text,text,text)','unknown(text,text,text)','pending(text,text,integer)','failed(jsonb)','due(text,text,integer)']
export const brokerSignatures=['output_status(jsonb,text,bigint)','output(jsonb,text,bigint)','broker_authorized(jsonb)']
const roles=['character_production_owner','character_production_generator','character_production_output_broker']
export function prepareProvisioning(read){
 const entries=sources.map(name=>{const source=read(name);if((source.match(/^BEGIN;$/gm)||[]).length!==1||(source.match(/^COMMIT;$/gm)||[]).length!==1)throw Error('Unexpected transaction boundaries');return {name,sha256:createHash('sha256').update(source).digest('hex'),sql:source.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')}})
 const pre=`-- REVIEW ONLY. No LOGINs, secrets, memberships for runtime, QA or activation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL createrole_self_grant='';
DO $$ BEGIN
 IF current_user<>session_user THEN RAISE EXCEPTION 'Direct reviewed installer session required'; END IF;
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'PostgreSQL 17 required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole)) THEN RAISE EXCEPTION 'CREATEROLE capability required'; END IF;
 IF NOT has_database_privilege(current_user,current_database(),'CREATE WITH GRANT OPTION') OR NOT has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION') OR NOT has_schema_privilege(current_user,'public','USAGE WITH GRANT OPTION') THEN RAISE EXCEPTION 'Installer needs grantable CREATE on database and public schema'; END IF;
 IF to_regnamespace('character_production') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'character_production_%') THEN RAISE EXCEPTION 'Existing foundation: reconcile first'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('character_production_owner','character_production_generator','character_production_output_broker')) THEN RAISE EXCEPTION 'Existing roles: reconcile first'; END IF;
 -- Do not broaden or revoke unrelated PUBLIC rights. Refuse unsafe base environment.
 IF EXISTS(SELECT 1 FROM pg_namespace n,aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='CREATE') OR EXISTS(SELECT 1 FROM pg_database d,aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='CREATE') THEN RAISE EXCEPTION 'PUBLIC CREATE prevents least privilege'; END IF;
END $$;
${roles.map(r=>`CREATE ROLE ${r} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`).join('\n')}
-- PG17 bootstrap ADMIN-only creator grants remain; add only temporary SET membership.
DO $$ BEGIN
 EXECUTE format('GRANT character_production_owner TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY %I',current_user,current_user);
 EXECUTE format('GRANT CREATE ON DATABASE %I TO character_production_owner',current_database());
END $$;
GRANT USAGE,CREATE ON SCHEMA public TO character_production_owner;
SET LOCAL ROLE character_production_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC;
`
 const grants=[...generatorSignatures.map(s=>`GRANT EXECUTE ON FUNCTION public.character_production_${s} TO character_production_generator;`),...brokerSignatures.map(s=>`GRANT EXECUTE ON FUNCTION public.character_production_${s} TO character_production_output_broker;`)].join('\n')
 const post=`
${grants}
RESET ROLE;
GRANT USAGE ON SCHEMA public TO character_production_generator,character_production_output_broker;
REVOKE CREATE ON SCHEMA public FROM character_production_owner;
DO $$ BEGIN
 EXECUTE format('REVOKE CREATE ON DATABASE %I FROM character_production_owner',current_database());
 EXECUTE format('REVOKE character_production_owner FROM %I GRANTED BY %I',current_user,current_user);
END $$;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['character_production_owner','character_production_generator','character_production_output_broker'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN RAISE EXCEPTION 'Unsafe role attributes %',r; END IF;
  IF has_database_privilege(r,current_database(),'CREATE') OR has_schema_privilege(r,'public','CREATE') THEN RAISE EXCEPTION 'Temporary CREATE leaked %',r; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('character_production_owner','character_production_generator','character_production_output_broker')) THEN RAISE EXCEPTION 'Role inheritance leaked'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname IN ('character_production_owner','character_production_generator','character_production_output_broker') AND (m.member<>(SELECT oid FROM pg_roles WHERE rolname=current_user) OR NOT m.admin_option OR m.inherit_option OR m.set_option)) THEN RAISE EXCEPTION 'Unexpected incoming role membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='character_production' OR (n.nspname='public' AND p.proname LIKE 'character_production_%')) AND pg_get_userbyid(p.proowner)<>'character_production_owner') THEN RAISE EXCEPTION 'Wrong function owner'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='character_production' AND c.relkind='r' AND (pg_get_userbyid(c.relowner)<>'character_production_owner' OR NOT c.relrowsecurity)) THEN RAISE EXCEPTION 'Wrong table owner or missing RLS'; END IF;
END $$;
COMMIT;
`
 return {manifest:entries.map(({name,sha256})=>({name,sha256})),sql:pre+entries.map(e=>e.sql).join('\n')+post}
}
if(process.argv[1]&&import.meta.url===new URL('file:'+process.argv[1]).href){
 const output=process.argv[2];if(!output?.endsWith('.review.sql'))throw Error('Explicit .review.sql destination required')
 const r=prepareProvisioning(name=>readFileSync(new URL('../docs/proposals/'+name,import.meta.url),'utf8'))
 writeFileSync(output,r.sql,{flag:'wx',mode:0o600});writeFileSync(output+'.manifest.json',JSON.stringify(r.manifest,null,2)+'\n',{flag:'wx',mode:0o600})
}
