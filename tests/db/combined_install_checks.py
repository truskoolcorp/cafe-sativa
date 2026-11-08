"""Whole first-install atomicity with modeled metadata faults, not actual grants.

Called only by the existing disposable harness before a clean installation.
Every variant is the entire migration transaction; no extracted predicate is
counted as an installation/rollback proof. This does not recreate exploit roles.
"""
import hashlib

FINGERPRINT = """SELECT md5(jsonb_build_object(
 'namespaces',(SELECT jsonb_agg(jsonb_build_array(oid,nspname,nspowner,nspacl::text) ORDER BY oid) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relkind,c.relacl::text) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','concierge_private')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attname,a.attacl::text,a.attidentity) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','concierge_private') AND a.attnum>0 AND NOT a.attisdropped),
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.proname,p.proowner,p.proacl::text,md5(p.prosrc),p.prosecdef,p.proconfig) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','concierge_private')),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.oid,t.tgrelid,t.tgname,t.tgfoid,t.tgenabled,t.tgtype) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','concierge_private')),
 'defaults',(SELECT jsonb_agg(jsonb_build_array(defaclrole,defaclnamespace,defaclobjtype,defaclacl::text) ORDER BY oid) FROM pg_default_acl),
 'memberships',(SELECT jsonb_agg(jsonb_build_array(roleid,member,grantor,admin_option,inherit_option,set_option) ORDER BY roleid,member,grantor) FROM pg_auth_members)
 )::text) AS fingerprint;"""

def variants(candidate):
    service="('service_role'::regrole)::oid"
    client="('authenticated'::regrole)::oid"
    faults={
        'schema-unexpected-create':f"SELECT 'schema',ns,0,owner_oid,{client},'CREATE',false",
        'schema-service-create':f"SELECT 'schema',ns,0,owner_oid,{service},'CREATE',false",
        'schema-service-grant-option':f"SELECT 'schema',ns,0,owner_oid,{service},'USAGE',true",
        'table-unexpected-delete':f"SELECT 'relation','concierge_private.requests'::regclass,0,owner_oid,{client},'DELETE',false",
        'table-service-insert':f"SELECT 'relation','concierge_private.requests'::regclass,0,owner_oid,{service},'INSERT',false",
        'lifecycle-service-update':f"SELECT 'relation','concierge_private.lifecycle'::regclass,0,owner_oid,{service},'UPDATE',false",
        'identity-column-service-insert':f"SELECT 'column','concierge_private.requests'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='concierge_private.requests'::regclass AND attname='cleanup_scan_id'),owner_oid,{service},'INSERT',false",
        'policy-column-service-update':f"SELECT 'column','concierge_private.policy'::regclass,(SELECT attnum FROM pg_attribute WHERE attrelid='concierge_private.policy'::regclass AND attname='max_retained_requests'),owner_oid,{service},'UPDATE',false",
        'helper-service-grant-option':f"SELECT 'function','concierge_private.requester_v1(uuid,text)'::regprocedure,0,owner_oid,{service},'EXECUTE',true",
        'helper-unexpected-execute':f"SELECT 'function','concierge_private.requester_v1(uuid,text)'::regprocedure,0,owner_oid,{client},'EXECUTE',false",
        'sequence-service-usage':f"SELECT 'relation','concierge_private.requests_cleanup_scan_id_seq'::regclass,0,owner_oid,{service},'USAGE',false",
        'backlog-helper-service-execute':f"SELECT 'function','concierge_private.guard_request_backlog_v1()'::regprocedure,0,owner_oid,{service},'EXECUTE',false",
    }
    marker=' ), expected(kind,object_oid,subid,grantor,grantee,privilege,is_grantable) AS ('
    assert candidate.count(marker)==1
    for name,row in faults.items():
        yield name,candidate.replace(marker,' UNION ALL '+row+'\n'+marker,1),'private ACL exact object privilege mismatch'
    public_marker='  ), public_expected(grantor,grantee,privilege,is_grantable) AS ('
    assert candidate.count(public_marker)==1
    public_faults={
        'public-rpc-service-grant-option': f"SELECT owner_oid,{service},'EXECUTE',true WHERE obj.service_access",
        'public-rpc-client-execute': f"SELECT owner_oid,{client},'EXECUTE',false WHERE obj.service_access",
        'public-auth-helper-service-execute': f"SELECT owner_oid,{service},'EXECUTE',false WHERE NOT obj.service_access",
        'public-rpc-wrong-grantor': f"SELECT {service},{service},'EXECUTE',false WHERE obj.service_access",
    }
    for name,row in public_faults.items():
        yield name,candidate.replace(public_marker,' UNION ALL '+row+'\n'+public_marker,1),'new public function exact ACL mismatch'
    # Alter only the read-only record projection used by the existing source gate.
    # No writer is actually changed, dropped, granted or executed under drift.
    old="SELECT p.prosrc,p.prosecdef,p.proacl::text AS acl,p.proconfig,pg_catalog.pg_get_userbyid(p.proowner) AS owner,"
    assert candidate.count(old)==1
    for name,new in [
        ('writer-body',old.replace('p.prosrc',"''::text AS prosrc")),
        ('writer-security',old.replace('p.prosecdef','false AS prosecdef')),
        ('writer-acl',old.replace('p.proacl::text AS acl',"'{}'::text AS acl")),
        ('writer-configuration',old.replace('p.proconfig','ARRAY[]::text[] AS proconfig')),
        ('writer-owner',old.replace('pg_catalog.pg_get_userbyid(p.proowner) AS owner',"'modeled_not_owner'::name AS owner")),
    ]:
        yield name,candidate.replace(old,new,1),'reviewed commerce writer missing or changed'
    trigger="CREATE TRIGGER concierge_request_backlog BEFORE INSERT ON concierge_private.requests\n FOR EACH ROW EXECUTE FUNCTION concierge_private.guard_request_backlog_v1();"
    assert candidate.count(trigger)==1
    yield 'missing-backlog-trigger',candidate.replace(trigger,'-- Modeled installation omission.',1),'combined first-install guard or identity index drift'


def verify(sql,candidate):
    assert sql("SELECT to_regnamespace('concierge_private') IS NULL;")=='t'
    before=sql('BEGIN READ ONLY;'+FINGERPRINT+'ROLLBACK;')
    count=0
    for name,altered,message in variants(candidate):
        try:
            sql(altered)
        except RuntimeError as exc:
            assert '55000' in str(exc) and message in str(exc),(name,str(exc))
        else:
            raise AssertionError('Modeled full installation unexpectedly accepted '+name)
        assert sql('BEGIN READ ONLY;'+FINGERPRINT+'ROLLBACK;')==before,name
        assert sql("SELECT to_regnamespace('concierge_private') IS NULL AND to_regprocedure('public.concierge_auth_statement_v1()') IS NULL AND to_regclass('concierge_private.requests_cleanup_scan_id_seq') IS NULL;")=='t',name
        count+=1
    print(f'PASS {count} modeled whole-install rejection/rollback cases; exact source SHA256 {hashlib.sha256(candidate.encode()).hexdigest()}')
