# Standing publication installer preparation (not live-ready)

This package prepares a **rollback-only rehearsal**, never connects to a database,
never reads credentials and has no commit flag. Do not remove ROLLBACK or apply the
proposal as a workaround. A separately reviewed live promotion is still required.

## Missing evidence and hard stop

No current production catalog manifest or approved expected-after manifest was
collected by this work. The generator requires both files and independently
reviewed SHA-256 values. Missing, incomplete, empty, mismatched or same manifests
stop generation. Hashes bind bytes, not human approval: the explicit review and any
required permission approval must happen separately. Synthetic unit-test manifests
are never production evidence.

Capture `scripts/cafe-standing-catalog.sql` read-only with this psql sequence;
`SET LOCAL` must precede the query so normalized identities match the installer.
The rollback leaves no persistent setting or database change:

```sql
BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
\i scripts/cafe-standing-catalog.sql
ROLLBACK;
```

Use psql unaligned tuples-only output (`-At`) to save the JSON manifest; do not
include transaction command tags or other output in the reviewed JSON file. The query exposes catalog definitions
and ACLs, not application rows or passwords; review function definitions as private
configuration. The expected-after manifest must come from a reviewed disposable
rehearsal of the exact source and exact baseline, not be invented or copied from an
unrelated database. It normalizes object identities rather than assuming matching
OIDs. Current six scheduler/four dispatch grants must survive exactly; no old
owner-only ACL snapshot or external-receipt count is reused.

Example generator interface, with placeholders deliberately not valid evidence:

```
python scripts/prepare-cafe-standing-install.py \
  --before reviewed-before.json --before-sha256 ACTUAL_REVIEWED_SHA \
  --after reviewed-after.json --after-sha256 ACTUAL_REVIEWED_SHA
```

Both sources are SHA-256 pinned to PR162. The rehearsal checks direct PG17 postgres,
exact before catalog, temporary dual-owner role/schema capabilities, source SQL,
empty new tables, temporary capability removal, then exact after catalog. Role,
membership, schema and default ACL manifests must be unchanged. Any mismatch aborts;
normal successful rehearsal also rolls back. This is deliberately not idempotent:
existing target objects fail creation and require reconciliation, never replacement.

## Exact proposed access/cost boundary

- Temporary: postgres SET into `character_production_owner` and
  `cafe_metricool_owner`; both get public-schema CREATE during DDL only. Removed
  before after-manifest comparison and rolled back at transaction end.
- Persistent proposed contract: the character owner adds security-definer
  `cs_cafe_generation_membership(uuid)`, granting EXECUTE only to Café store owner
  (in addition to its creator's inherent rights). It returns bounded existing
  enrollment/candidate identity; no generation/auth table grant.
- New Café tables/functions are owned by the existing Café owner. Existing
  `authorized(uuid,text)` gains the standing-scope conjunct for linked authority.
- New scoped authority RPC and two semantic budget RPCs remain denied to PUBLIC,
  anon, authenticated and service_role. This does not activate service authority.
- No budget, policy, binding, enrollment, candidate, receipt or publishing row is
  inserted. No provider/model request, HeyGen spend, top-up or social post occurs.
- Any later runtime grant must separately disclose effective inherited paths,
  including Storage/admin and authenticator roles. Existing approvals are not
  assumed to cover this new capability.

## Validation and remaining work

Four provider-free Python unit tests cover manifest binding, lifecycle refusal,
noop refusal and rollback-only output. PostgreSQL execution of this installer
wrapper and evidence query is still pending. Existing PR162 contract PG17 tests do
not validate this new wrapper. A real production installer requires verified live
baseline, reviewed expected delta, disposable PG17 lifecycle/ACL/drift tests,
independent review and applicable approval. Runtime composition and semantic-model
expense authorization remain separate; the $20 HeyGen budget is not an Anthropic
allowance. No end-to-end readiness is claimed.
