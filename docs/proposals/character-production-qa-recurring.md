# Dormant slot-bound QA enrollment proposal

No live installation, grants, planner, recurring schedule, paid authorization, or runtime switch is included. This is not evidence of working recurring production.

A trusted owner-context planner must first create the ordinary **blank, unapproved draft** and the separately approved production slot. It inserts a disabled `qa_slot_bindings` row containing the exact slot key, digest, immutable slot JSON, unique draft UUID and exact current `updated_at`, validates provenance, then enables it. This role must follow the same slot → job (if present) → binding → target → draft lock order. Ordinary worker/backend roles receive no planner table rights. There is deliberately no jobs foreign key on the prebinding.

`character_production_qa_ready_slots(limit)` discovers at most five enabled, exact pending-QA candidates. This is not authorization. `character_production_qa_materialize(key,digest)` revalidates locked live state and atomically creates only the existing bridge target. Exact replay is true, including the existing receipt-aware bridge state; any mismatch is false. It never creates a draft, job, paid claim, storage object or approval. The existing audited private bridge subsequently performs byte verification/copy/CAS. The original payment expiry is never modified or interpreted as fresh spending permission.

Disabling or deleting a materialized binding also disables its bridge target. Retargeting or re-enabling a materialized binding is rejected; explicit separately reviewed reconciliation is needed. A revocation concurrent with materialization serializes on the binding row; conflicting planner lock order can cause a safe transaction abort, not a retry authorization.

## Additional installation prerequisites (not applied)

A separate safe installer must use existing `character_production_owner`, preserve original memberships/ACLs and source ownership, restore temporary CREATE/REFERENCES/namespace privileges, and create the companion policies as original draft table owner. Existing draft SELECT and two-column UPDATE rights are sufficient. The new prebinding SELECT policy exposes only enabled prebound drafts to this non-login owner. A second UPDATE policy with `WITH CHECK(false)` permits locking those rows but does not permit a write before an existing target authorizes it. No existing policy is removed or relaxed.

The proposal grants no runtime EXECUTE. A later reviewed composition must specify the precise backend RPC grants, trusted planner configuration and default-off switch. Other roles cannot enumerate or materialize. Existing QA evidence and publication approval remain separate requirements.

## Verification

`python3 tests/postgres/validate_qa_recurring.py` runs only against a disposable PostgreSQL17 cluster. It first executes the existing non-superuser QA installer suite, then tests this **proposal contract** with temporary fixture DDL rights restored. It is not a proof of a new production installer. The separate GitHub workflow supplies real PG17. Local Python syntax checks are not PostgreSQL execution.
