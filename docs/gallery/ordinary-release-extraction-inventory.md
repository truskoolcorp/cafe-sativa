# Ordinary Gallery release extraction inventory — 2026-11-24

Pinned main `4e2e45a98ab2b5fb393bfd6d1cbfc4d74706f74b`, draft #255 `ac776ec666cba48042be4c5d4d2d31565087e72b`: 96 ahead, 0 behind, 74 changed paths. Both refs and open draft verified. Exact draft CI succeeded: Stripe offline 45503600240, Gallery responsive 45503600269, concierge 45503600161, persona 45503600194 and Vercel combined status success. These are not signed Stripe/provider or real customer acceptance. #266 remains a separate, currently nonmergeable draft. Do not merge #255 or #266 wholesale. This inventory is a path-level extraction plan, not full final diff approval, and must be refreshed on current main when the actual narrow candidate is ready.

## Ordinary-commerce candidate (review and re-test; not an approved cherry-pick) — 26

- `app/account/artwork/page.tsx`
- `app/api/gallery/checkout/route.ts`
- `app/api/gallery/download/route.ts`
- `app/api/gallery/webhook/route.ts`
- `app/api/gallery/worker/route.ts`
- `app/gallery/thanks/DownloadArtwork.tsx`
- `app/gallery/thanks/page.tsx`
- `docs/gallery/proposed-approved-artwork-assets.sql`
- `docs/gallery/proposed-artwork-publication-guard.sql`
- `docs/gallery/proposed-delivery-outbox.sql`
- `docs/gallery/proposed-financial-review-views.sql`
- `docs/gallery/proposed-fulfillment-authorization.sql`
- `docs/gallery/proposed-house-checkout.sql`
- `docs/gallery/proposed-inventory-consumption.sql`
- `docs/gallery/proposed-inventory-reservations.sql`
- `docs/gallery/proposed-private-delivery-migration.sql`
- `docs/gallery/proposed-refund-ledger.sql`
- `docs/gallery/proposed-settlement-observations.sql`
- `lib/gallery/environment.ts`
- `lib/gallery/fulfill-digital.ts`
- `lib/gallery/house-checkout.ts`
- `lib/gallery/observe-stripe-settlement.ts`
- `lib/gallery/reconcile-inventory.ts`
- `lib/gallery/reconcile-refunds.ts`
- `lib/gallery/send-delivery-notices.ts`
- `lib/gallery/stage-approved-artwork.ts`

## Shared or mixed paths (selective hunks only; require dependency review) — 10

- `.github/workflows/stripe-webhook-regression.yml`
- `app/account/page.tsx`
- `app/api/artists/sync/route.ts`
- `app/api/products/route.ts`
- `app/api/webhooks/stripe/route.ts`
- `app/artist-dashboard/page.tsx`
- `app/gallery/[slug]/page.tsx`
- `tests/browser/gallery/responsive-qa.cjs`
- `tests/stripe-entitlements.cjs`
- `tests/stripe-webhook-regression.test.cjs`

## Hold out of first extraction (separate optional releases or test-only reporting) — 24

- `app/api/concierge/route.ts`
- `app/api/concierge/speak/route.ts`
- `app/api/gallery/financial-review/route.ts`
- `app/ask/page.tsx`
- `app/gallery/GalleryWallet.tsx`
- `app/gallery/financial-review/FinancialReview.tsx`
- `app/gallery/financial-review/page.tsx`
- `docs/gallery/proposed-artwork-creation-method.sql`
- `docs/gallery/proposed-wallet-nonce-migration.sql`
- `docs/gallery/zaria-curator-contract.md`
- `lib/concierge/personas.ts`
- `lib/concierge/request.ts`
- `lib/content/host-portraits.ts`
- `lib/gallery/approved-collections.ts`
- `lib/gallery/artwork-creation-method.ts`
- `lib/gallery/collector-access.ts`
- `lib/gallery/consume-nonce.ts`
- `lib/gallery/curator-catalog.ts`
- `lib/gallery/financial-review-display.ts`
- `lib/gallery/persist-test-settlement.ts`
- `lib/gallery/token-ownership.ts`
- `lib/gallery/wallet-challenge.ts`
- `tests/concierge-capability.test.cjs`
- `tests/concierge-route.test.cjs`

## QA and operational evidence (never run against production) — 14

- `docs/gallery/collection-release-requirements.md`
- `docs/gallery/isolated-house-sandbox.md`
- `docs/gallery/ordinary-launch-gates.md`
- `docs/gallery/proposed-worker-schedule.md`
- `tests/fixtures/gallery-local-house-base.sql`
- `tests/gallery-checkout.cjs`
- `tests/gallery-download.test.cjs`
- `tests/gallery-environment.test.mjs`
- `tests/gallery-financial-review.test.cjs`
- `tests/gallery-house-local-driver.mjs`
- `tests/gallery-house-sandbox-prep.mjs`
- `tests/gallery-postgres-fixture.sh`
- `tests/gallery-settlement.test.cjs`
- `tests/helpers/load-gallery-environment.cjs`

## Extraction rules

- Start from fresh main, preserve already-live /gallery landing and unrelated files. The candidate group is review scope, not an unconditional allowlist. Only the approved house PNG debut is intended to be offered at first; no physical, NFT, or unapproved independent listings. An independent consigned synthetic fixture still must prove the split and refund path. Reconcile #266 after its owner resolves conflicts; do not use public or legacy delivery URL as a workaround.
- Select only the ordinary detail checkout gate from app/gallery/[slug]/page.tsx; omit optional creation-method import/label unless the separately tested default-off dependency is retained. Product API and artist dashboard changes contain optional creation-method wiring: strip those hunks together if excluded. Keep publication review enforced and artist onboarding separate from editorial approval. Do not pick wallet or curator code as dependencies.
- Account page adds only the artwork-library link. Artist sync removes auto-approval based on Connect capabilities. Review both with their Gallery-only behavior and preserve unrelated membership experience. Shared Stripe route requires hunk-by-hunk classification (including account.updated, Gallery payment, ticket refunds, and membership paths); run existing non-Gallery tests as well as Gallery failure-path checks. Do not carry shared concierge code, changed tests alone, or unverified webhook routing into production. No actual shared production event replay.
- Financial review test routes and persistence helper must remain isolated-only until a real authenticated, mode-scoped artist/owner reporting path and provider persistence/scheduling are independently verified. These are mandatory commerce capabilities, not optional requirements waived by excluding test-only endpoints from the first extraction. Existing worker invokes authorization, notices, inventory reconciliation, not settlement observation. No production staff authorization or real provider observation is established by current source. Complete those before sales activation.
- Test DB isolation must exclude both production and the explicitly prohibited existing replica; the current environment guard explicitly denies the production host but accepts a matching hosted test URL generically. Do not treat matching URLs as sufficient identity evidence or run against the old replica. The isolated harness owner should add a negative case for the excluded replica without overlapping ongoing key/runner work. Use verified disposable local DB/storage or dedicated test-only resources, never shared preview secrets.
- The current worker schedule is proposed only. Confirm existing no-incremental-cost scheduling limits, authentication, concurrency, no real QA notices and exact environment before activation; no production cron or global flag changes here.

## Migration dependency order to revalidate

The actual disposable PostgreSQL fixture applies the first nine SQL files in this order: private-delivery, approved-artwork-assets, fulfillment-authorization, delivery-outbox, inventory-reservations, inventory-consumption, refund-ledger, settlement-observations, house-checkout (all proposed-*.sql, private-delivery-migration for the first). It then applies financial-review-views and artwork-publication-guard on the first database fixture. The proposed consigned private entitlement SQL in #266 is separate: establish its compatible order with publication guard and base payment RPC from the exact rebased candidate. No optional method/wallet migration in the ordinary release. These fixture results do not prove hosted migration compatibility.

Before any production migration, read-only compare existing columns, relation/view definitions, RPC signatures/bodies/owners, policies, triggers, grants, and storage policies against the final SQL. Verify no name collision and no loss of existing grants or security-definer behavior. Apply reviewed additive migrations transactionally with new sales off and monitor non-Gallery flows; stop on mismatch. No schema writes or migration execution in this inventory.

## Acceptance record to attach to the future narrow candidate

1. Exact current main/candidate SHAs and complete path/diff comparison; explicit review of every shared hunk and dependency. New unrelated paths are blockers, not auto-included. All exact-head checks green, plus actual rendered desktop/mobile/keyboard/reduced-motion with approved assets.
2. Private Docker runner, verified dedicated merchant sandbox, isolated DB/storage/auth pair, loopback signed ingress and no notice emails. Actual house and consigned provider events/amounts plus competing holds, replay, buyer-only download, denied nonbuyer, full refund denial and review-only restock. Distinguish provider data from fixtures. No credentials in public repo or logs.
3. Verified approved $12 debut asset checksum, private storage and actual public derivative, correct house account binding, production reporting/scheduling and reviewed rights/delivery terms. No other approved listings inferred.
4. Deploy with new sales disabled and verify read-only production listing/availability/price, no unintended Stage/membership/ticket changes, no NFT/wallet, no unverified curator/media. Switch only Gallery when every gate is met; retain working existing-order handling. Rollback is Gallery new-sales disable and scoped redeploy, never remove shared Stripe credentials or roll back unrelated changes. Record actual public URL, deployment, logs/read-only smoke and rollback evidence. No live test purchase/refund.

No production changes, provider calls, secrets, spend, or other PR edits in this audit.

## Integration refresh — 2026-11-25 UTC

Exact integrated draft `c8a4b5590a93850de56e4a7008a45241da2af42d`, same main as above, 98 ahead/0 behind, 77 changed paths. All four exact-head workflows passed: Stripe offline 45527835167, Gallery responsive 45527835345, persona 45527835228, concierge 45527835213; Vercel success. The three additions to the 74-path inventory are this inventory document (operational evidence), `docs/gallery/proposed-consigned-private-checkout.sql` (ordinary-commerce migration candidate), and `tests/gallery-consigned-private-postgres.sh` (QA-only fixture). #266's reviewed private consigned path is integrated in #255; its standalone QA workflow is excluded. The existing Stripe regression invokes the consigned fixture. The new migration remains subject to the production RPC compatibility and actual provider acceptance gates. No blanket release approval.

This follow-up explicitly denies both known production and excluded replica database hostnames in the nonproduction Gallery environment guard, even when the configured test URL matches. Adds a regression to the existing environment suite. A matching hosted URL for any other project is still **not** proof of disposable ownership or isolation; independently verify before running any provider test. No connection to either excluded database, no new resources, no live operations. New guard checks must pass on their own commit.
