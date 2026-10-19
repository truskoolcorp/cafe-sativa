# Café Sativa — guarded migration, refunds, interruption, and replication gate (2026-10-17)

## Environment and source of truth
Production remains Supabase `nwfxvhqbjtfvoopcadff`; Neon `twilight-dream-09426151`, branch `br-long-forest-b5wk52ne`, database `cafe_sativa_stage` is **synthetic-only**. No production database writes, real Stripe charges, posts, or customer data copies were performed.

### Reproducible schema-only extraction
Run `scripts/cafe-sativa-schema-only-gate.sh` with a **read-only Supabase Postgres URL**, a **fresh, empty, dedicated Neon staging direct URL**, and `CS_AUTHORIZE_EMPTY_SCHEMA_REPLAY=YES`. It verifies the target database name, refuses populated targets, and runs `pg_dump --schema-only --schema=public --no-owner --no-privileges` inside a private temporary directory. It does **not** apply raw DDL: export is a guarded preparation stage only. Source `auth.users` FKs, managed extensions, Supabase Auth/Storage, outbound mail triggers and roles require separately reviewed versioned changes. No complete reproducible automated restore is certified. Do not run against this already-populated staging database.

The earlier live-catalog reconstruction in staging was verified by object counts: 28 app tables, 12 enums, 112 constraints, 94 indexes, 12 public functions, 10 triggers, 35 RLS policies, 3 views, 106 defaults. Synthetic `auth.users` and mock `auth.uid`/`auth.role` are **not production authentication**; passport welcome-email trigger is disabled. Exact object counts are not sufficient to certify schema/security equivalence.

## Isolated payment tests performed
- **Ticket crash:** Run the actual `cs_record_ticket_payment` inside a nested transaction block, raise a synthetic error, then catch it at the outer block. Ticket lookup after simulated crash returned **0 tickets**. Retrying the paid synthetic receipt returned `created:true` and ticket `be653903-50d7-416f-984b-ed3c8b26a773`; replay returned `created:false` with identical ticket ID. This demonstrates rollback + idempotent retry for this transaction boundary, **not** guaranteed notification/outbox delivery.
- **Refund behavior:** With synthetic staging data, refund-state updates reflecting the current `charge.refunded` webhook yielded 1 refunded gallery order and 1 refunded ticket. Physical inventory remained 4 after the original purchase reduced it from 5. **No restock occurs in the webhook path**; this is a fulfillment/business-rule gap to resolve explicitly before production certification. Existing member entitlements and cross-transaction refunds were not certified.
- Earlier tests: competing ticket-payment RPC calls produced one created ticket and one replay; gallery payment replay did not double-decrement stock.

## Synthetic replication fence / recovery prototype
Created **only in Neon staging**:
- `cs_validation.replication_fence(stream PRIMARY KEY,writer_id,epoch CHECK(epoch>0),checkpoint,updated_at)`
- `cs_validation.replica_events(sequence_no PRIMARY KEY,writer_epoch,event_key UNIQUE,payload_hash,applied_at)`
- Initialized writer `neon-staging`, epoch 1, checkpoint 0. Applied one synthetic event and advanced checkpoint to 1. A stale writer-id/epoch condition changed **0 rows**. Promoted a simulated recovery writer to epoch 2: stale epoch-1 checkpoint update changed **0 rows** and checkpoint remained 1.
- Epoch promotion/readback in one database transaction recorded ~0.004 seconds for the transaction-local observation; **this is not cross-provider RTO**, and no measurable cross-provider RPO exists.

**Critical limitation:** This test is of a local fencing/checkpoint design, not logical replication. The separate Supabase development branch needed for a real Neon-to-Supabase replication/restore test requires cost confirmation; the provider rejected its creation without a confirmation ID. No paid branch, external replica, publication/subscription, CDC slot, production write switch or automatic failover was created.

## Cross-provider implementation gates
1. After owner-approved Supabase development-branch cost, provision a **separate sandbox** with no live data; never enable CDC against production as part of testing.
2. Apply a reviewed, versioned, safe app schema to both isolated databases and import **synthetic data only**.
3. Use a single monotonically increasing epoch and durable checkpoint, enforce fencing **at every write entrypoint** in the actual database/API—not just an advisory table. Test race/crash/duplicate and stale-leader rejection.
4. Test initial snapshot followed by captured changes, ordering/deletion, conflict/lag, logical replication capabilities and permissions, schema evolution and exact hash/count parity. Record real test times and measured RPO/RTO and network reconnect behavior.
5. Verify no external replay of Stripe charges, email, Metricool posts, ticket issuance or fulfillment; restore and fail back with one fenced writer and explicit reconciliation.
6. Keep Supabase Auth/Storage operational until authenticated runtime parity and RLS are independently validated. Hold production switch until owner approves a reviewed rollback/cutover plan.

**Status:** Reproducible guarded schema extraction available; staged refund and interrupted-RPC execution tested; synthetic fencing prototype tested; **cross-provider replication and automatic failover remain unimplemented and uncertified** because the isolated Supabase branch requires explicit cost authorization and source/target routing needs production-grade fencing.

## Approved hourly-cost Supabase isolated branch — 2026-10-17

Owner explicitly approved **$0.01344/hour** for a Supabase development branch. Branch `cafe-sativa-neon-replica-test-20261017`, ref `anrprovgdpwqcalkolsz`, parent `nwfxvhqbjtfvoopcadff`, was created using Supabase's cost-confirmation flow. Initial project health `ACTIVE_HEALTHY`, branch has no production data; 28 application tables and 35 public RLS policies are present through its migration history. Branch may incur hourly compute/usage charges until removed. Do not point production applications to it.

### First controlled cross-provider synthetic event-transfer verification
- In Supabase **branch only**, created separate `cs_replication_test.control` and `cs_replication_test.events`, and revoked PUBLIC, `anon`, `authenticated` rights from schema/tables.
- Read 3 synthetic events from Neon staging `cs_validation.replica_events` and explicitly applied the same key/hash/epoch/sequence payloads into the Supabase branch in a manual, controlled transaction sequence.
- Both endpoints independently returned 3 records; compared sequence, epoch, event key, and payload hash field-by-field. **All three matched exactly**. Destination checkpoint advanced to 3.
- A deliberately stale writer (old ID and epoch 1) attempted a checkpoint advance and changed no records. A writer promotion from epoch 1 to epoch 2 had been demonstrated in isolated Neon staging before this test.
- The third synthetic event's explicit Neon insert followed by Supabase branch insert+checkpoint update took **3,327 milliseconds wall clock from orchestrator**. That is one observed transfer latency, **not** ongoing replication lag, CDC lag, measured RPO/RTO, or failover downtime.
- No native PostgreSQL subscription, publication, replication slot, durable external worker, trigger-based CDC, continuous sync, cross-provider credential bridge, automatic failover, or fencing at *every real application write entrypoint* has been enabled.
- Replication scope was limited to a private synthetic schema, with no live production/canonical data or OAuth credentials. This is a contract feasibility test rather than full database replication.
- The branch must be retired when no longer needed to prevent unbounded hourly spend; obtain approval before destructive cleanup.
