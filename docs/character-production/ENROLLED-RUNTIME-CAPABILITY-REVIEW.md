# Six-RPC capability proposal: offline review, not activation

Base source checked against main `c197256`. The existing PR136 three-wrapper
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
SET service_role, and the reviewed source installer inherits it. Exact expected
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
