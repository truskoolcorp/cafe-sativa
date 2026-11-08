-- Read-only assertions of the complete first installation.
BEGIN READ ONLY;
DO $combined_first_install$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='concierge_private.policy'::regclass
   AND attname='max_retained_requests' AND atttypid='bigint'::regtype AND NOT attnotnull AND NOT atthasdef)
  OR NOT EXISTS(SELECT 1 FROM concierge_private.policy WHERE singleton AND NOT enabled AND max_retained_requests IS NULL)
  OR NOT EXISTS(SELECT 1 FROM concierge_private.lifecycle WHERE singleton AND reject_before_ms=0
     AND last_cleanup_at IS NULL AND cleanup_scan_after=0 AND cleanup_scan_through IS NULL)
  OR EXISTS(SELECT 1 FROM concierge_private.requests)
 THEN RAISE EXCEPTION 'combined first-install policy or lifecycle drift' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='concierge_private.requests'::regclass
    AND tgname='concierge_request_backlog' AND tgfoid='concierge_private.guard_request_backlog_v1()'::regprocedure
    AND tgtype=7 AND tgenabled='O' AND NOT tgisinternal)
  OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indrelid='concierge_private.requests'::regclass
    AND indexrelid='concierge_private.requests_cleanup_scan_id_key'::regclass
    AND indisunique AND indisvalid AND indisready)
 THEN RAISE EXCEPTION 'combined first-install guard or identity index drift' USING ERRCODE='55000'; END IF;
END $combined_first_install$;

DO $postconditions$
DECLARE seq oid:=pg_get_serial_sequence('concierge_private.requests','cleanup_scan_id')::regclass; col text; who text;
BEGIN
 IF seq IS DISTINCT FROM 'concierge_private.requests_cleanup_scan_id_seq'::regclass
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='concierge_private.requests'::regclass AND attname='cleanup_scan_id' AND atttypid='bigint'::regtype AND attnotnull AND attidentity='a')
  OR NOT EXISTS(SELECT 1 FROM pg_sequence WHERE seqrelid=seq AND seqtypid='bigint'::regtype AND seqmin=1 AND seqincrement=1 AND seqcache=1 AND NOT seqcycle)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=seq AND relowner=(current_user::regrole)::oid)
  OR NOT EXISTS(SELECT 1 FROM pg_depend d JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
      WHERE d.objid=seq AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass
        AND d.deptype='i' AND d.refobjid='concierge_private.requests'::regclass AND a.attname='cleanup_scan_id')
 THEN RAISE EXCEPTION 'surrogate review identity ownership mismatch' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=seq AND a.grantee<>(current_user::regrole)::oid)
   OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
    WHERE p.oid IN ('concierge_private.maintain_v1(integer)'::regprocedure,'concierge_private.guard_cleanup_scan_id_v1()'::regprocedure,'concierge_private.guard_request_backlog_v1()'::regprocedure)
      AND a.grantee<>(current_user::regrole)::oid)
 THEN RAISE EXCEPTION 'surrogate review unexpected inherited object ACL' USING ERRCODE='55000'; END IF;
 FOREACH who IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_sequence_privilege(who,seq,'USAGE,SELECT,UPDATE')
   OR has_column_privilege(who,'concierge_private.requests','cleanup_scan_id','INSERT,UPDATE')
   OR has_function_privilege(who,'concierge_private.maintain_v1(integer)','EXECUTE')
  THEN RAISE EXCEPTION 'surrogate review effective privilege leak' USING ERRCODE='55000'; END IF;
 END LOOP;
 FOREACH col IN ARRAY ARRAY['requester','request_id','user_id','session_id','host','conversation_id','payload','fingerprint','redacted','state','charged','admitted_at','issued_at','content_expires_at','tombstone_retention_seconds','redacted_at','quarantined_at','provider_receipt','lease_until','dispatch_marked_at','finished_at','owner_token','user_message_id','assistant_message_id','tier','policy_version','remaining_at_admission','reserved_cost_microusd','max_reply_chars','response']::text[] LOOP
  IF NOT has_column_privilege('service_role','concierge_private.requests',col,'INSERT')
   OR NOT has_column_privilege('service_role','concierge_private.requests',col,'UPDATE')
  THEN RAISE EXCEPTION 'surrogate review existing column capability lost' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF has_table_privilege('service_role','concierge_private.requests','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_table_privilege('service_role','concierge_private.lifecycle','INSERT,UPDATE,DELETE,TRUNCATE')
 THEN RAISE EXCEPTION 'surrogate review unexpected table write capability' USING ERRCODE='55000'; END IF;
END $postconditions$;
DO $private_acl_postflight$
DECLARE owner_oid oid:=(current_user::regrole)::oid; service_oid oid:=('service_role'::regrole)::oid;
 ns oid:='concierge_private'::regnamespace; mismatch boolean; obj record; who record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE oid=ns AND nspowner=owner_oid)
  OR (SELECT array_agg(relname::text ORDER BY relname) FROM pg_class WHERE relnamespace=ns AND relkind='r') IS DISTINCT FROM ARRAY['lifecycle','policy','requests']::text[]
  OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace=ns AND (relowner<>owner_oid OR relkind NOT IN ('r','S','i')))
  OR (SELECT array_agg(relname::text ORDER BY relname) FROM pg_class WHERE relnamespace=ns AND relkind='S') IS DISTINCT FROM ARRAY['requests_cleanup_scan_id_seq']::text[]
  OR (SELECT array_agg(proname::text ORDER BY proname) FROM pg_proc WHERE pronamespace=ns) IS DISTINCT FROM ARRAY['expired_terminal_v2','guard_cleanup_scan_id_v1','guard_conversation_v1','guard_lifecycle_v1','guard_message_v1','guard_request_backlog_v1','guard_request_identity_v2','guard_statement_v1','issued_at_v2','lock_v1','maintain_v1','missing_error_v2','owned_v1','requester_v1','result_v1','valid_payload_v1','valid_receipt_v1']::text[]
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace=ns AND (proowner<>owner_oid OR prosecdef))
 THEN RAISE EXCEPTION 'private ACL object identity or owner drift' USING ERRCODE='55000'; END IF;
 -- Compare exact normalized ACLs, including privilege type, grantor, grantee,
 -- grantability, and column scope. An unknown role is not made safe by RLS or
 -- by also inheriting service_role. Do not silently revoke its defaults.
 WITH actual(kind,object_oid,subid,grantor,grantee,privilege,is_grantable) AS (
  SELECT 'schema',n.oid,0,a.grantor,a.grantee,a.privilege_type,a.is_grantable
   FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.oid=ns
  UNION ALL
  SELECT 'relation',c.oid,0,a.grantor,a.grantee,a.privilege_type,a.is_grantable
   FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
   WHERE c.relnamespace=ns AND c.relkind IN ('r','S')
  UNION ALL
  SELECT 'column',c.oid,x.attnum,a.grantor,a.grantee,a.privilege_type,a.is_grantable
   FROM pg_class c JOIN pg_attribute x ON x.attrelid=c.oid
   CROSS JOIN LATERAL aclexplode(NULLIF(x.attacl,'{}'::aclitem[])) a
   WHERE c.relnamespace=ns AND x.attnum>0 AND NOT x.attisdropped
  UNION ALL
  SELECT 'function',p.oid,0,a.grantor,a.grantee,a.privilege_type,a.is_grantable
   FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace=ns
 ), expected(kind,object_oid,subid,grantor,grantee,privilege,is_grantable) AS (
  SELECT 'schema',ns,0,owner_oid,owner_oid,v,false FROM unnest(ARRAY['USAGE','CREATE']) v
  UNION ALL SELECT 'schema',ns,0,owner_oid,service_oid,'USAGE',false
  UNION ALL SELECT 'relation',c.oid,0,owner_oid,owner_oid,v,false FROM pg_class c
   CROSS JOIN LATERAL unnest(CASE WHEN c.relkind='S' THEN ARRAY['USAGE','SELECT','UPDATE'] ELSE ARRAY['INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] END) v
   WHERE c.relnamespace=ns AND c.relkind IN ('r','S')
  UNION ALL SELECT 'relation',c.oid,0,owner_oid,service_oid,'SELECT',false FROM pg_class c WHERE c.relnamespace=ns AND c.relkind='r'
  UNION ALL SELECT 'column',c.oid,x.attnum,owner_oid,service_oid,v,false FROM pg_class c
   JOIN pg_attribute x ON x.attrelid=c.oid CROSS JOIN unnest(ARRAY['INSERT','UPDATE']) v
   WHERE c.oid='concierge_private.requests'::regclass AND x.attname=ANY(ARRAY['requester','request_id','user_id','session_id','host','conversation_id','payload','fingerprint','redacted','state','charged','admitted_at','issued_at','content_expires_at','tombstone_retention_seconds','redacted_at','quarantined_at','provider_receipt','lease_until','dispatch_marked_at','finished_at','owner_token','user_message_id','assistant_message_id','tier','policy_version','remaining_at_admission','reserved_cost_microusd','max_reply_chars','response']::text[]) AND NOT x.attisdropped
  UNION ALL SELECT 'function',p.oid,0,owner_oid,owner_oid,'EXECUTE',false FROM pg_proc p WHERE p.pronamespace=ns
  UNION ALL SELECT 'function',p.oid,0,owner_oid,service_oid,'EXECUTE',false FROM pg_proc p
   WHERE p.pronamespace=ns AND p.proname<>ALL(ARRAY['maintain_v1','guard_cleanup_scan_id_v1','guard_request_backlog_v1']::text[])
 ), difference AS ((SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual))
 SELECT EXISTS(SELECT 1 FROM difference) INTO mismatch;
 IF mismatch THEN RAISE EXCEPTION 'private ACL exact object privilege mismatch' USING ERRCODE='55000'; END IF;
 -- Effective privilege assertions complement raw ACL equality. Role attributes
 -- and SET/inheritance reachability are checked again in the same transaction.
 FOR who IN SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
  IF has_schema_privilege(who.oid,ns,'CREATE') OR has_schema_privilege(who.oid,ns,'USAGE WITH GRANT OPTION')
    OR has_schema_privilege(who.oid,ns,'USAGE') IS DISTINCT FROM (who.rolname='service_role')
  THEN RAISE EXCEPTION 'private ACL effective schema privilege mismatch' USING ERRCODE='55000'; END IF;
  FOR obj IN SELECT oid FROM pg_class WHERE relnamespace=ns AND relkind='r' LOOP
   IF has_table_privilege(who.oid,obj.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    OR has_table_privilege(who.oid,obj.oid,'SELECT WITH GRANT OPTION')
    OR has_table_privilege(who.oid,obj.oid,'SELECT') IS DISTINCT FROM (who.rolname='service_role')
   THEN RAISE EXCEPTION 'private ACL effective table privilege mismatch' USING ERRCODE='55000'; END IF;
  END LOOP;
  FOR obj IN SELECT p.oid,p.proname FROM pg_proc p WHERE p.pronamespace=ns LOOP
   IF has_function_privilege(who.oid,obj.oid,'EXECUTE WITH GRANT OPTION')
    OR has_function_privilege(who.oid,obj.oid,'EXECUTE') IS DISTINCT FROM (who.rolname='service_role' AND obj.proname<>ALL(ARRAY['maintain_v1','guard_cleanup_scan_id_v1','guard_request_backlog_v1']::text[]))
   THEN RAISE EXCEPTION 'private ACL effective function privilege mismatch' USING ERRCODE='55000'; END IF;
  END LOOP;
 END LOOP;
END $private_acl_postflight$;
-- New public functions have their own exact contract. Private-schema checks do
-- not cover public-schema defaults; reject inherited recipients/grant options
-- rather than rewriting defaults or any pre-existing commerce function ACL.
DO $new_public_acl_postflight$
DECLARE owner_oid oid:=(current_user::regrole)::oid; service_oid oid:=('service_role'::regrole)::oid;
 obj record; who record; mismatch boolean;
BEGIN
 FOR obj IN SELECT signature,service_access,settings FROM (VALUES
  ('public.concierge_admit_v1(uuid,text,uuid,jsonb,text)',true,ARRAY['search_path=""','lock_timeout=2s','statement_timeout=5s']::text[]),
  ('public.concierge_dispatch_v1(text,uuid,uuid)',true,ARRAY['search_path=""','lock_timeout=2s','statement_timeout=5s']::text[]),
  ('public.concierge_complete_v1(text,uuid,uuid,text,text,boolean,jsonb)',true,ARRAY['search_path=""','lock_timeout=2s','statement_timeout=5s']::text[]),
  ('public.concierge_finish_v1(text,uuid,uuid,text,jsonb)',true,ARRAY['search_path=""','lock_timeout=2s','statement_timeout=5s']::text[]),
  ('public.concierge_status_v1(uuid,text,uuid,jsonb)',true,ARRAY['search_path=""','lock_timeout=2s','statement_timeout=5s']::text[]),
  ('public.concierge_auth_statement_v1()',false,ARRAY['search_path=""','lock_timeout=2s']::text[])
 ) AS expected(signature,service_access,settings) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure(obj.signature) AND p.proowner=owner_oid AND NOT p.prosecdef
      AND p.proconfig=obj.settings AND l.lanname='plpgsql')
  THEN RAISE EXCEPTION 'new public function identity or security drift: %',obj.signature USING ERRCODE='55000'; END IF;
  WITH public_actual(grantor,grantee,privilege,is_grantable) AS (
   SELECT a.grantor,a.grantee,a.privilege_type,a.is_grantable FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=to_regprocedure(obj.signature)
  ), public_expected(grantor,grantee,privilege,is_grantable) AS (
   SELECT owner_oid,owner_oid,'EXECUTE'::text,false
   UNION ALL SELECT owner_oid,service_oid,'EXECUTE',false WHERE obj.service_access
  ), difference AS ((SELECT * FROM public_actual EXCEPT SELECT * FROM public_expected)
     UNION ALL (SELECT * FROM public_expected EXCEPT SELECT * FROM public_actual))
  SELECT EXISTS(SELECT 1 FROM difference) INTO mismatch;
  IF mismatch THEN RAISE EXCEPTION 'new public function exact ACL mismatch: %',obj.signature USING ERRCODE='55000'; END IF;
  FOR who IN SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','supabase_auth_admin') LOOP
   IF has_function_privilege(who.oid,to_regprocedure(obj.signature),'EXECUTE WITH GRANT OPTION')
    OR has_function_privilege(who.oid,to_regprocedure(obj.signature),'EXECUTE')
       IS DISTINCT FROM (obj.service_access AND who.rolname='service_role')
   THEN RAISE EXCEPTION 'new public function effective ACL mismatch: %',obj.signature USING ERRCODE='55000'; END IF;
  END LOOP;
 END LOOP;
END $new_public_acl_postflight$;
ROLLBACK;
