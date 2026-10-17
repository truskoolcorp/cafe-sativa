# Café Sativa production payment audit and Neon-primary migration plan — 2026-10-17

**Evidence:** Read-only Supabase project `nwfxvhqbjtfvoopcadff` / `cafe-sativa-prod` (TS_Empire); connected Neon project listing; current GitHub server/client code. This is a plan, **not an approved cutover**.

## Production payment state (read only)

| Table | Observed rows | Interpretation |
|---|---:|---|
| `memberships` | 1 | Active VIP; **no Stripe customer or subscription ID**. Do not interpret as a paid subscription. Preserve existing entitlement/grant provenance. |
| `tickets` | 3 | One valid comp and two valid tier-included; no Stripe payment intent; recorded paid cents total 0. |
| `cs_ticket_reservations` | 0 | No persisted purchased-ticket reservation to verify live replay. |
| `orders` / `order_items` | 0 / 0 | No settled gallery fulfillment record to replay. |
| `events` | 11 | All tagged scheduled; this does **not** establish tickets are publicly offered or event dates approved. |
| `products` | 0 | No live product fulfillment case. |

Production `cs_record_ticket_payment` verifies site, paid currency, identity, amount and reservation/session/intent; locks event and hold and handles duplicate state atomically. `cs_record_gallery_payment` locks product, checks stock and duplicate session. Both require exact database replay/inventory testing on an isolated restored copy; offline webhook mocks do not prove live transactions. Do **not** create live charges or impersonate purchase receipts to test.

Security review: 29 physical `public` tables have RLS enabled. The project's Supabase advisor flags `my_events_v` (security-definer view), 3 functions with mutable search paths, and 14 foreign-key index recommendations. Audit grants/view users before remediation. Service-only tables lacking browser policies can be intentional.

## Required Neon-primary / Supabase-backup architecture

1. **Inventory and ownership:** Source system is Supabase Postgres `nwfxvhqbjtfvoopcadff`, currently used for `auth.users` FKs, RLS policies, Supabase Auth, Storage, Data API, RPCs and application service writes. Existing Vercel `POSTGRES_HOST` is also the Supabase hostname—not Neon. No matching dedicated Café Sativa Neon project is visible in the connected Tru Skool Neon organization. Do not reuse a different project's database.
2. **Isolated destination:** Obtain owner confirmation of dedicated Café Sativa Neon project/organization and operational cost constraints. Provision a dedicated staging branch / database, not shared business instances. Avoid importing user/password material, secrets, encrypted OAuth ciphertext or raw PII into unrelated environments. Keep tokens/keys server-only.
3. **Schema portability audit:** Export schema-only definitions and extension usage from a controlled admin environment, including `auth.users` references, RLS/grants, enum/check constraints, triggers, functions, service-role RPCs, Storage references, internal job locks, Stripe idempotency, profile/session ownership and notification mail flows. Supabase-managed auth/storage/Data API do not automatically move to Neon. Decide whether Supabase Auth/Storage remain authoritative while Neon owns carefully scoped application tables; design security-checked direct data layer and migration of RPC semantics before routing any writes.
4. **Single writer & replication design:** Test an initial consistent snapshot + CDC with replication privileges/capability supported by both providers. Verify ordering, schema/version, delete propagation, unique keys, tombstones, replication lag and auditable checkpoints. Avoid pretending that Neon-primary + Supabase-backup is already configured. Consider provider limits, logical replication direction, and cost; if bidirectional recovery is unsupported, use tested **backup/restore with planned failover** instead of marketing automatic failover.
5. **Critical exactly-once business flows:** Before cutover, test at-least-once Stripe webhooks and crash/retry boundaries against restored data (same Stripe session/intent); duplicate RPC calls must issue one ticket/order and decrement inventory at most once. Test refund, fulfillment/entitlement, membership grant provenance, database locks, Metricool token rotation/single-writer and duplicate-post protections. No automatic cross-database replay of ambiguous external actions.
6. **Auth/RLS security parity:** Supabase Auth can remain identity issuer, but Neon must independently verify tokens server-side and enforce tenant/user authorization; do not move `service_role` credentials to browsers. Validate admin roles, security-definer exposure, FK integrity and complete domain routing across all API paths. Preserve current canonical content, job budget and approvals.
7. **Dry run and acceptance:** On isolated branch restore, compare row counts, key checksum sets, object references, payment invariants, and read/write behavior, then test planned-failover and failback under a **fenced single writer**. Record measured RPO/RTO, loss/lag limits and rollback playbook. Cut over only with owner approval, verified backup, maintenance/write-fencing, health checks and automated rollback to known-good state. Never cut over on a read-only audit.
8. **Post-cutover:** Reconcile delayed Stripe events, social receipts and content jobs before re-enabling external dispatch. Keep the production Supabase backup read-only and test periodic restore drills. If cost or replication capabilities cannot meet requirements, maintain Supabase primary temporarily and postpone Neon-primary switch.

## Separate social receipt work

`cs_social_deliveries.state` is constrained to queued, submitting, scheduled, submission_unknown, blocked, canceled. PR #18 writes **provider-confirmed publication evidence into `receipt`** only after matching persisted post id, UUID, content and publication time, and exactly Facebook + Threads PUBLISHED with HTTPS public URLs. The UI derives a published display label without an unauthorized production schema change. Only normal authorized reconciliation writes receipts; the read-only probe stays non-mutating. Historical rows must be reconciled by the normal authorized scheduler after deployment; no backfill or provider submissions were performed during this audit.
