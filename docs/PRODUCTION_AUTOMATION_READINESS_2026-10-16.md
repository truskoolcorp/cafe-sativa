# Café Sativa automation readiness — evidence audit (2026-10-16)

## Verified existing implementation
- Vercel project `virtual-cafe-sativa` reports production deployment READY, custom domains `cafe-sativa.com` and `www.cafe-sativa.com`.
- Stripe webhook code **exists** at `app/api/webhooks/stripe/route.ts`. It verifies signature, restricts ticket checkout to paid Café Sativa metadata and invokes atomic DB payment RPC `cs_record_ticket_payment`; gallery uses `cs_record_gallery_payment`. Membership subscription status and refund cases are handled. Offline tests in `tests/stripe-webhook-regression.test.cjs` and CI are present. **Do not interpret these as confirmed live payments or fulfillment.**
- Café membership price allowlist is in `lib/membership-prices.ts`. Stripe catalog IDs share the `IDc7LlvDW9` identifier seen in one of multiple connected live Stripe account IDs, but account/price ownership must be verified through the targeted Stripe account before financial actions.
- Content cron `app/api/content/cron/route.ts` authenticates schedule requests and plans/publishes approved site content. `app/api/content/worker/route.ts` delegates to content worker. Canonical asset registry `cs_canonical_assets` gates publishing.
- Website social status endpoint `app/api/content/social/status/route.ts` exposes connection verification, dispatch-enabled state, and durable receipt/error checks; user-facing Metricool integration is separate and does not establish website OAuth health.
- `docs/CONTENT_AUTOMATION.md` reports owner $25/month generation cap, fifteen approved venue references, eight production-ready GLYPH characters, six pending program introductions and unfinished full episode generation **as of Oct 10**. These are historical status statements until live reverified.

## Acceptance gates NOT demonstrated by this audit
- Authentication/member registration and actual entitlement after a confirmed noncharging webhook event against persistent test DB.
- Ticket inventory reservations and Stripe payment -> admission and refund compensation, including replay safety in a real database.
- Membership cancel/renewal and payment failure reconciliation backed by live Stripe receipts.
- Event dates, capacities, confirmed performers/hosts, products and delivery terms. No speculative listings or charges.
- LiveKit host worker/audio, room access control and published approved GLYPH episodes.
- Website-owned Metricool OAuth connected, correct channels mapped, real scheduled/publication receipts and automated recovery.
- Cron schedule actually firing in the hosted environment; content job retries, alerting, approval audit trail, dead letter handling.

## Immediate nonfinancial verification checklist
1. Inspect production **environment variable names and target scope only**, not secret values, for Supabase, Stripe, CRON_SECRET, Metricool, LiveKit and content budget.
2. Read `docs/METRICOOL_OAUTH.md`, `docs/PUBLISHING_RECEIPTS.md`, and the current canonical source table. Separate approvals from actual provider receipts.
3. Run existing webhook offline CI plus a sandbox/persistent database replay test (one paid ticket event delivered twice -> one order and one entitlement; cancellation and refund reverse exactly once). No live charge.
4. Verify membership and reservation routes + RLS, record observed behavior/receipts, and only then authorize real payment/fulfillment testing.
5. Maintain fail-closed content gate: no substitute character/venue likeness, no public auto-generation outside owner budget/approval.

## Database ownership / connection blocker confirmed
- The Vercel production `NEXT_PUBLIC_SUPABASE_URL` points to Supabase project ref `nwfxvhqbjtfvoopcadff` (non-secret public project identifier only).
- This ref is **not in the currently connected Supabase account's list of accessible projects**. Do not run a test against a similarly named or unrelated Supabase project. A separately scoped connection or direct approved test database access is needed to verify `cs_record_ticket_payment` and replay/refund semantics against real constraints.
- Vercel production has environment variable **names** for Stripe, Supabase service role, CRON_SECRET, LiveKit, and CS_SOCIAL_ENCRYPTION_KEY. Presence does not establish valid credentials, correct resource ownership or successful scheduled execution; no secret values disclosed.
- Stripe offline regression workflow for PR #15 completed successfully on commit `2959d526ddae665d8ff4369d3a9f7404219fea61`; this confirms only mocked handler behavior.

## Supabase ↔ Neon automatic failover audit (2026-10-16)
- Connected Supabase project `nwfxvhqbjtfvoopcadff` returned a permission error. The project ref matches Vercel `NEXT_PUBLIC_SUPABASE_URL`, but the current connector cannot inspect its tables, WAL or replication.
- Connected Neon organizations `Tru Skool Corp` and `Ingram Legacy Holdings` list projects for Integration Hub, Commerce Inventory, GLYPH, etc., and **no explicitly identified Café Sativa replica**.
- `lib/supabase/admin.ts` directly builds a Supabase client from `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; no Neon alternate or retry routing exists in that code path. Vercel has `POSTGRES_URL` but presence of two connection variables is not proof of replication or failover.
- **Failover NOT CERTIFIED.** Before enabling any switch: verify the canonical writer, same-schema replica, sync mechanism / replication lag, auth/RLS parity, fencing/single-writer promotion, failback and idempotent Stripe webhook replay. A naive catch-and-retry to Neon on network error can double-fulfill tickets and mishandle uncertain commits; never automatically replay an unacknowledged payment write.
- Read-only next step: identify which project `POSTGRES_URL` references (hostname only, do not disclose password), inspect matching Neon schema, then test simulated outage/failover in an isolated environment. Keep production database routing unchanged.

### Production Postgres host identification
Read-only inspection of Vercel `POSTGRES_HOST` shows `db.nwfxvhqbjtfvoopcadff.supabase.co`, the **same Supabase project** as the application URL, not Neon. The sensitive `POSTGRES_URL` value was unavailable for hostname parsing. Conventional alternate-client paths `lib/db.ts`, `lib/database.ts`, `lib/neon.ts` and `prisma/schema.prisma` were absent (absence of these paths alone does not prove no other integration). No basis to designate any accessible Neon project as Café Sativa failover. Keep failover disabled pending explicit endpoint mapping and replication proof.

## Metricool provider reconciliation — verified 2026-10-16
Connected Metricool brand 5373515 confirmed these **provider-side PUBLISHED** receipts (not merely pending schedules):
- October 12 video, post 390856410: Facebook https://facebook.com/1260321256112306/posts/2000223097558621 ; Threads https://www.threads.com/@truskoolcorp/post/DeaeVQYEY_w
- October 14 concept promotion, post 390803327: Facebook https://facebook.com/1260321256112306/posts/1568560448621717 ; Threads https://www.threads.com/@truskoolcorp/post/Defn7SJCteF
- October 16 concept promotion, post 390803425: Facebook https://facebook.com/1260321256112306/posts/1570498208427941 ; Threads https://www.threads.com/@truskoolcorp/post/DekxhVMCINq
The connected brand ID and permitted Facebook/Threads destinations match the website's previously documented allowlist. Source code in `lib/content/social-delivery.ts` preserves fail-closed behavior on ambiguous delivery and does not silently replay submissions. **Not yet verified**: current website-owned OAuth refresh state and internal `cs_social_connections`/`cs_social_deliveries` records because access to Café Sativa's production Supabase project is unavailable. Provider publication success alone does not certify unattended future scheduling.

## Metricool read-only safety production release
- Isolated PR #16 merged as `e073aa06a160257562b9399cb0b26058443553af`.
- Vercel production deployment `dpl_DE39yX9EaYAvaT2YHJ3idC9JaLzP` status `READY` (verified), with independent social-probe CI successful.
- This establishes release of source-level ledger write guards, **not** authenticated live probe execution or website OAuth/ledger health. Provider publication receipts for Oct 12, 14 and 16 are independently verified.
