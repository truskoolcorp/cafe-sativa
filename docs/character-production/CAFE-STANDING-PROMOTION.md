# Dormant, commit-capable contract promotion

`prepare-cafe-standing-promotion.py` is an **offline SQL generator**. It has no database client, connection, credentials, RPC call, provider call, or automatic execution. Merely merging it cannot install or activate anything. Its output can persist the owner-only contracts, unlike the existing rehearsal generator which remains rollback-only. Never manually remove a rehearsal's `ROLLBACK`.

Before operational use, independently verify a fresh read-only live catalog, the exact expected-after candidate and its derivation/source provenance, the rehearsal hash, and **explicit action approval covering this installation**. The generator requires approval/review references but cannot authenticate them; a fabricated or stale reference is not consent. Do not generate an operational artifact until those conditions hold. No permission is inferred from a merge, test, generic continuation, or preview.

The new generator pins the reviewed rehearsal generator and both underlying sources, regenerates its exact before/after-guarded SQL and verifies its digest. It preserves both catalog guards, the five-empty-table assertion, and the restoration of temporary role/schema privileges. It adds transaction-time expiry checks both before DDL and immediately before commit; expiry must be future and at most 30 minutes at preparation. Drift, expiry, unexpected activation data or an interrupted transaction fails closed. Retrying after uncertain completion is prohibited: read-only reconcile first. Installed objects are non-idempotent and the old baseline rejects a second execution.

Output is an exclusively created file outside the repository with initial `0600` permissions. Never upload private manifests or SQL to GitHub. The only normal console output is the artifact digest, marked prepared/not executed.

## Exact scope

This persists five empty tables and ten contract functions, changes existing `authorized()` only by adding the standing-revocation conjunct, and gives Café owner the bounded generation-membership function. Temporary postgres SET/schema CREATE is restored exactly. It neither grants runtime service_role/PUBLIC/anon/authenticated access nor creates scopes, enrollments, budgets, attempts, approvals, receipts or posts. The raw writer remains owner-only. Later three-wrapper runtime grants and inherited role paths, finite enrollment, separately bounded Anthropic spending, genuine content QA and verified end-to-end execution remain distinct decisions and work.

## Validation

Local provider-free tests validate digest/refusal, expiry, guard preservation and private no-overwrite output. The expanded disposable PostgreSQL17 fixture exercises promotion commit and exact persistence, before/after drift rejection, expiry before DDL and at final guard, no activation data/runtime grants, preservation of the six scheduler/four dispatch permissions, and rejection of replay. Record actual exact-head CI results before claiming these passed. All fixture references and manifests are synthetic, not production approval or proof of production compatibility.
