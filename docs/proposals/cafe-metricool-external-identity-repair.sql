-- REVIEW ONLY: exact existing production-owner repair; no activation or runtime grant.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
DO $pre$
BEGIN
 IF current_user<>'postgres' OR current_user<>session_user OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Exact non-superuser source and PG17 required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolcreaterole) THEN RAISE EXCEPTION 'Expected non-superuser source bootstrap'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cafe_metricool_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Restricted existing owner required'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole OR member='cafe_metricool_owner'::regrole)<>1 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='cafe_metricool_owner'::regrole AND member='postgres'::regrole AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN RAISE EXCEPTION 'Exact ADMIN-only bootstrap topology required'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR pg_has_role(current_user,'cafe_metricool_owner','USAGE') THEN RAISE EXCEPTION 'Unexpected existing owner authority'; END IF;
END $pre$;
CREATE TEMP TABLE cafe_repair_members ON COMMIT DROP AS SELECT * FROM pg_auth_members;
CREATE TEMP TABLE cafe_repair_roles ON COMMIT DROP AS SELECT * FROM pg_roles;
CREATE TEMP TABLE cafe_repair_defaults ON COMMIT DROP AS SELECT * FROM pg_default_acl;
CREATE TEMP TABLE cafe_repair_acl ON COMMIT DROP AS
 SELECT jsonb_build_object('schemas',(SELECT jsonb_agg(jsonb_build_array(oid,nspowner,nspacl::text) ORDER BY oid) FROM pg_namespace WHERE nspname IN ('public','auth','cafe_metricool_private')),'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','cafe_metricool_private')),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p)) AS snapshot;
GRANT cafe_metricool_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
SET LOCAL ROLE cafe_metricool_owner;
DO $repair$
DECLARE target oid; before_proc jsonb; before_rows jsonb; after_rows jsonb; old_definition text; next_definition text; before_roles jsonb;
BEGIN
 IF current_user<>'cafe_metricool_owner' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Exact existing owner and PG17 required'; END IF;
 SELECT p.oid,to_jsonb(p) INTO target,before_proc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='cafe_metricool_private' AND p.proname='authorized' AND p.proargtypes='2950 25'::oidvector;
 IF target IS NULL OR (before_proc->>'proowner')::oid<>(SELECT oid FROM pg_roles WHERE rolname='cafe_metricool_owner') OR md5(before_proc->>'prosrc')<>'fc45ae0745fcfada4b9c884c3cc7933a' OR (SELECT proacl::text FROM pg_proc WHERE oid=target)<>'{cafe_metricool_owner=X/cafe_metricool_owner}' THEN RAISE EXCEPTION 'Exact original authorized body owner ACL required'; END IF;
 LOCK TABLE cafe_metricool_private.external_receipts, cafe_metricool_private.approvals, cafe_metricool_private.attempts IN SHARE MODE;
 IF (SELECT count(*) FROM cafe_metricool_private.external_receipts)<>22 OR EXISTS(SELECT 1 FROM cafe_metricool_private.external_receipts WHERE evidence->>'promoId' IS NULL OR evidence->>'promoId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN RAISE EXCEPTION 'Existing frozen receipt identities required'; END IF;
 SELECT jsonb_build_object('receipts',(SELECT jsonb_agg(to_jsonb(e) ORDER BY provider_id,brand_id,network,account_id,video_sha256) FROM cafe_metricool_private.external_receipts e),'approvals',(SELECT jsonb_agg(to_jsonb(a) ORDER BY plan_id) FROM cafe_metricool_private.approvals a),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY plan_id) FROM cafe_metricool_private.attempts a)) INTO before_rows;
 SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r),'members',(SELECT jsonb_agg(to_jsonb(r) ORDER BY roleid,member,grantor) FROM pg_auth_members r),'defaults',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_default_acl r)) INTO before_roles;
 old_definition:=pg_get_functiondef(target);
 next_definition:=replace(old_definition,'e.video_sha256=s->>''videoSha256'' OR e.scheduled_at=','e.evidence->>''promoId''=d.id::text OR e.video_sha256=s->>''videoSha256'' OR e.scheduled_at=');
 IF next_definition=old_definition THEN RAISE EXCEPTION 'Expected predicate missing'; END IF;
 EXECUTE next_definition;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target)<>'b851290417cceb49a25ab085e75f4765' OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM before_proc-'prosrc' THEN RAISE EXCEPTION 'Unexpected function metadata delta'; END IF;
 SELECT jsonb_build_object('receipts',(SELECT jsonb_agg(to_jsonb(e) ORDER BY provider_id,brand_id,network,account_id,video_sha256) FROM cafe_metricool_private.external_receipts e),'approvals',(SELECT jsonb_agg(to_jsonb(a) ORDER BY plan_id) FROM cafe_metricool_private.approvals a),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY plan_id) FROM cafe_metricool_private.attempts a)) INTO after_rows;
 IF after_rows IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'Unexpected row changes'; END IF;
 IF (SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r),'members',(SELECT jsonb_agg(to_jsonb(r) ORDER BY roleid,member,grantor) FROM pg_auth_members r),'defaults',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_default_acl r))) IS DISTINCT FROM before_roles THEN RAISE EXCEPTION 'Unexpected privilege changes'; END IF;
END $repair$;
RESET ROLE;
REVOKE cafe_metricool_owner FROM postgres GRANTED BY postgres;
DO $post$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Source role not restored'; END IF;
 IF EXISTS((SELECT * FROM pg_auth_members EXCEPT SELECT * FROM cafe_repair_members) UNION ALL (SELECT * FROM cafe_repair_members EXCEPT SELECT * FROM pg_auth_members)) THEN RAISE EXCEPTION 'Membership restoration mismatch'; END IF;
 IF EXISTS((SELECT * FROM pg_roles EXCEPT SELECT * FROM cafe_repair_roles) UNION ALL (SELECT * FROM cafe_repair_roles EXCEPT SELECT * FROM pg_roles)) THEN RAISE EXCEPTION 'Role restoration mismatch'; END IF;
 IF EXISTS((SELECT * FROM pg_default_acl EXCEPT SELECT * FROM cafe_repair_defaults) UNION ALL (SELECT * FROM cafe_repair_defaults EXCEPT SELECT * FROM pg_default_acl)) THEN RAISE EXCEPTION 'Default ACL restoration mismatch'; END IF;
 IF pg_has_role(current_user,'cafe_metricool_owner','SET') OR pg_has_role(current_user,'cafe_metricool_owner','USAGE') THEN RAISE EXCEPTION 'Temporary authority remained'; END IF;
 IF (SELECT snapshot FROM cafe_repair_acl) IS DISTINCT FROM
 (SELECT jsonb_build_object('schemas',(SELECT jsonb_agg(jsonb_build_array(oid,nspowner,nspacl::text) ORDER BY oid) FROM pg_namespace WHERE nspname IN ('public','auth','cafe_metricool_private')),'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','cafe_metricool_private')),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p))) THEN RAISE EXCEPTION 'Schema table or RLS changes'; END IF;
END $post$;
COMMIT;
