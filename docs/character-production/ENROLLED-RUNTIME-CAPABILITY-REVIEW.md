# Six-RPC capability proposal: offline review, not activation

Base source checked against main `e1b1d98`. The existing PR136 three-wrapper
proposal remains unexecuted. This combined transaction supersedes it for this
planned runtime; it must NOT be applied after the three-wrapper proposal. All
six target functions must start owner-only. Partial/already-applied state causes
refusal and requires reconciliation rather than silently adding the remainder.

The only persistent delta is owner-issued, non-grantable EXECUTE to existing
service_role on scheduler_context, scheduler_reconciled, scheduler_plan,
scheduler_due, scheduler_pending, and scheduler_qa_ready. Existing functions and
bodies, other ACLs, roles/memberships, source and ledger rows remain unchanged.
No new credential, enrollment, flag, schedule, table grant or raw planner grant.

The emitter pins and reuses the prior reviewed capability transaction and exact
principal body checks; the three read bodies are pinned to their reviewed source.
It adds source-row/trigger preservation and exact function-set assertions. SQL
installation prerequisites are already separate: this does not install functions.

## Effective identity caveat

This is service-role capability, not a dedicated autonomous principal. Existing
Supabase service_role is NOLOGIN INHERIT BYPASSRLS. The reviewed authenticator can
SET service_role, and the reviewed source installer inherits it. The observed
managed supabase_storage_admin login can also SET service_role through its sole
membership in authenticator, but does not inherit service_role USAGE. Exact expected
membership graph and effective access checks reject additional non-superuser
principals. Superusers retain inherent authority. UUID parameters alone are not
authentication: wrappers require current enrolled policy/actor/candidate scope.
Any live topology mismatch blocks this proposal; do not relax it automatically.

## Still required before functional recurring execution

Fresh reviewed policy, finite enrollment, exact production asset/audio/scene
bindings, quote and included-credit evidence, tested private QA flow and explicit
runtime activation remain separate. No active enrollment currently exists.
Granting these six functions alone neither creates work nor proves end-to-end
provider/publication success. Human/perceptual QA and watermark requirements are
not replaced by scoped reads or private ingestion.

## Test scope

Disposable PG17 fixture chains the actual restricted-owner installers with
verbatim SQL, reproduces reviewed proxy topology, and tests rollback, redirected
grants, unexpected effective membership, source/body/ACL drift, partial prior
capability, exact six successes, denied raw planners/table access and duplicate
application refusal. Python compilation and deterministic emission checked;
actual PG17 execution pending CI. No live changes performed.


## Managed Storage topology correction: new approval required

The first live preflight refused safely; all six functions remained owner-only
and temporary SET authority was absent. The new expected principal is explicitly
`supabase_storage_admin`, not any arbitrary indirect member. Fresh observed
attributes are LOGIN, NOSUPERUSER, NOINHERIT, NOCREATEDB, CREATEROLE,
NOREPLICATION and NOBYPASSRLS; settings are search_path=storage and
log_statement=none. Its only direct membership edge in either direction is
storage_admin -> authenticator, grantor supabase_admin, ADMIN false, INHERIT
false, SET true. The existing authenticator -> service_role edge remains pinned
by the original reviewed service topology checks.

The correction requires that exact role, attributes/settings and sole edge,
plus effective SET true and USAGE false, before allowing its name in the effective
principal checks. It grants no role membership and changes none of these role
attributes. CREATEROLE is an existing managed capability, not a new grant or an
assertion of long-term privilege isolation; current-graph checks cannot prevent
later privileged topology changes. Unexpected direct or indirect paths still
block. All role/catalog snapshots remain exact.

This material effective-access disclosure requires a new scoped owner approval
before a live retry. Earlier approval is not treated as approval of this changed
principal set. Offline fixture adds the managed path and rejects extra edges,
missing/altered managed edge and attribute drift. Actual PG17 rerun pending.
