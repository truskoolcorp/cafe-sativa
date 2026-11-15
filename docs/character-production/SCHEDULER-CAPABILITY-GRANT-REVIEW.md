# Future scoped scheduler EXECUTE delta

Offline proposal only. **No grant has been applied by this work.** Parent must
review the exact change with a genuine finite enrollment before authorizing it.
No enrollment/candidate/actor identity is manufactured by this artifact.

The emitted SQL grants EXECUTE on exactly:
- public.character_production_scheduler_context(uuid)
- public.character_production_scheduler_reconciled(uuid,integer)
- public.character_production_scheduler_plan(uuid,integer,jsonb)

to the existing service_role, without grant option. All remain owned by the
restricted character_production_owner. No raw planner/source helper, private
schema/table, auth data, provider credential or runtime membership grant is added.

Existing service_role is a broad infrastructure credential. These three scoped
functions constrain newly added planner authority, not all preexisting powers of
that role. Current canon/rights validation remains trusted server evidence. The
SQL derives stored actor/candidate/policy and enforces current enrollment and
binding; EXECUTE alone cannot create enrollment. Do not describe this as
independent protection against a compromised service-role process.

Emitter pins the reviewed principal proposal and extracts exact wrapper bodies.
Private scheduler_current, scheduler_immutable and scheduler_binding_revoke bodies
and exact owner/language/return/security/ACL identities are checked against the
same pinned proposal, using catalog lookup without adding private schema USAGE.
Separate live preflight must also verify existing planner/admin/wallet dependency
body hashes against reviewed versions before any approved application.
Precheck verifies direct PG17 source owner, restricted role/bootstrap, exact
wrapper owner/body/language/return/search-path/security and owner-only baseline
ACL. Temporary source SET membership permits the exact owner grants and is
removed. Existing data, default ACLs, other role grants, memberships, namespaces,
table/column ACLs, RLS, policies and function bodies/owners are preserved and
checked. Unexpected baseline privileges abort, rather than being silently removed.
The public schema CREATE privilege is never granted.

Disposable fixture uses the actual distinct-owner prerequisite chain. It covers
rollback, injected abort, wrong grantee, baseline drift, public/private security-mode drift, altered private guard body,
exact final EXECUTE set, raw/source/table denial, absent enrollment denial, and
reapplication refusal. Emitter generation/Python compilation pass locally; PG17
CI must run before claiming verification of this new delta.

Separate production approval and activation are still required. Approval of this
code or CI does not enroll a scheduler or turn on generation/publication.

## Verified role topology and effective access
Preflight requires the observed service_role NOLOGIN/INHERIT/BYPASSRLS baseline
and authenticator LOGIN/NOINHERIT/non-bypass baseline. Exact service-role members
are the source owner (ADMIN/INHERIT/SET) and authenticator (SET only), from the
same bootstrap grantor as the ledger owner. Ledger owner has no parent roles or
other members; service_role has no parent roles. Unexpected direct or transitive
SET/INHERIT paths fail closed. No roles or memberships are created in production.

Effective capability is not literally exclusive to service_role: its legitimate
source owner inherits it, authenticator may SET ROLE to it, and database
superusers inherently retain access. These existing paths are documented and
preserved, not additional grants. All other non-superuser effective wrapper
EXECUTE paths are rejected. Role attributes and membership catalog are preserved.
Disposable tests reproduce this topology and inject unsafe ledger/service/proxy
memberships, including transitive SET escalation, to verify refusal.
