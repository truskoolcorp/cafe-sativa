# Dormant recurring planner adapter review

Inert implementation. No route, cron, production RPC privilege, policy seed, provider request, or publication change.

`createCharacterProductionPlanner` opens no dependencies when disabled. When enabled by reviewed composition, it captures a frozen slot, validates exact shape and the existing USD 2000-cent Dallas-calendar cap, and obtains a fresh evidence capsule from a trusted injected validator. It calls only `character_production_plan`, with SDK retries disabled. Missing policy is a blocked result; ambiguous write/receipt mismatch is held, not retried. A receipt can establish planning identity only, not generation or publication success.

The adapter intentionally requires runtime-supplied, current canonical rights, portrait/audio bindings and policy evidence. It cannot turn caller assertions into authority. SQL remains responsible for policy revision locks, unique daily slots, aggregate limits and atomic blank private draft creation.

## Verification

- 42 targeted planner and trusted-validator tests pass (disabled/no dependency, exact RPC, $20 cap, Dallas month, invalid scope, stale evidence, mutation, abort, ambiguous write, wrong receipt).
- Focused strict TypeScript passes.
- Broader `character-production*.test.mjs`: 282 pass using the existing exact locked `@supabase/storage-js` 2.104.0 via local `NODE_PATH`. No package or lockfile changes. A full offline `npm ci` is unavailable because the webrtc-adapter tarball is not cached; this does not constitute a full Next build.
- Added `createPlannerValidator`: read-only policy epoch reads bracket current canon and exact source/provider/quote/theme evidence. Revocation, wrong canonical voice, stale evidence, timeout, abort and changed policy all block. Actual policy/binding transports still need composition.
- Disposable PG17 CI run 43647172351 passed on head 27a1c4e, including restricted-role, rollback, concurrency and revocation assertions; artifact 14134805981. All four PR workflows passed.
- No live provider requests, synthesis, renders, DB mutations or publication.

## Remaining before deployment/activation

1. Independent review completed: no blocker to inert merge; no runtime-role grant or activation permitted by this proposal.
2. Restricted PG17 fixture passed against planner and source-owner helper. Integrated production wallet/source transport validation remains required.
3. Install exact-reviewed narrow SQL and privileges under the user's applicable production approval. Do not install the raw proposal.
4. Compose the trusted validator with real current canonical sources; validate against production evidence, not synthetic tests.
5. Add reviewed finite owner policy and scheduler integration. Preserve no-auto-topup evidence expiry and all QA/watermark/publication gates.
6. Verify one actual end-to-end automatic execution and actual publication receipts before claiming automation works.

## Disposable PostgreSQL CI scaffold

`tests/postgres/validate_planner.py` and `.github/workflows/planner-postgres.yml`
exercise the dormant proposal using a fresh localhost PostgreSQL 17 service.
The test runs DDL and planner calls as non-superuser owners, checks runtime-role
permission denial, transaction/helper-failure rollback, concurrent exact replay,
private unapproved draft output, day/cap exclusions, no job or budget mutations,
and policy revocation. It reuses the synthetic recurring-QA fixture.

The calendar and boolean administrator dependency are explicitly synthetic test
doubles. This does **not** establish integrated wallet/claim enforcement or
production installer readiness. No live backend is targeted. The fixture is
executed successfully in isolated GitHub CI. PostgreSQL remains unavailable locally.
No production database was contacted.
