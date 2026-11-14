-- READ ONLY. Inventory only: no credentials, object contents, scripts or URLs.
-- Proposed role names are expectations, NOT an instruction to create/grant them.
-- Run using an authorized metadata reader; empty/missing results are blockers.
WITH expected_roles(name) AS (VALUES
 ('character_production_owner'),('character_production_policy'),
 ('character_production_generator'),('character_production_qa'))
SELECT e.name, r.oid IS NOT NULL AS present, r.rolcanlogin, r.rolsuper,
 r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
 ARRAY(SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid) AS inherited_roles
FROM expected_roles e LEFT JOIN pg_roles r ON r.rolname=e.name;

SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,
 c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='character_production' AND c.relkind='r'
ORDER BY c.relname;

SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,
 ARRAY(SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE a.privilege_type='EXECUTE') AS execute_grantees
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'character_production_%'
ORDER BY p.proname;

-- Supabase metadata query kept separate: a missing storage schema must fail,
-- rather than inventing a private bucket. Public=false alone is not ACL proof.
SELECT id,public,file_size_limit,allowed_mime_types
FROM storage.buckets WHERE id IN ('character-production-private','cafe-sativa-content');
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='storage' AND tablename='objects';

SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl
FROM pg_namespace WHERE nspname='character_production';
SELECT pg_get_userbyid(defaclrole) AS owner,defaclnamespace,defaclobjtype,defaclacl
FROM pg_default_acl;
SELECT r.rolname,n.nspname,c.relname,
 has_schema_privilege(r.oid,n.oid,'USAGE') AS schema_usage,
 has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
 has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
 has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
 has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname IN ('anon','authenticated','service_role','character_production_generator','character_production_qa')
 AND n.nspname='character_production' AND c.relkind='r';
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='storage' AND tablename='buckets';
