# Café Sativa replication v1 (isolated staging only)

This change is **not a production cutover**, production replication or permission to schedule/enable external workers.

Source Neon: `twilight-dream-09426151`, `cafe_sativa_stage`, branch `br-long-forest-b5wk52ne`.
Target Supabase development project: `anrprovgdpwqcalkolsz`.
Production still uses Supabase `nwfxvhqbjtfvoopcadff`.

## Protocol
`database/replication/001_isolated_outbox_inbox.sql` installs a durable table-backed stream with writer lease/epoch, append-only outbox, unique event IDs, ordered inbox and checkpoint. A recorded delete is a **tombstone event**: no live application row is deleted by this prototype. `scripts/replication/replicate-batch.cjs` contains a provider-neutral bounded loop. It requires injected source/destination adapters and currently has **no active runner or secrets**, deliberately preventing a production launch.

Worker restarts read durable destination checkpoints; only a successful atomic destination acknowledgment advances a batch. Any sequence gap, unrecognized event, or transfer failure stops processing. The destination function locks its checkpoint, enforces contiguous event sequences and rejects changed payloads for an existing sequence/event. The source append function checks its lease/epoch under row lock. This does **not yet fence actual Café Sativa writes**, which still use Supabase SDK/RPC directly. Do not connect the worker to live business tables until write-path fencing and transactional outbox updates are atomic in each path.

## Isolated cross-provider execution on 2026-10-17
Applied `001_isolated_outbox_inbox.sql` to both stage environments, with all schema grants removed from PUBLIC. Created synthetic Neon lease for stream `isolated-test` and appended:
- Sequence 1 / upsert `synthetic:alpha`, provider-generated event UUID.
- Sequence 2 / delete tombstone for the same aggregate.
Applied both via the Supabase branch `apply_event`, replayed sequence 2, and read `last_sequence=2`. No production data copied, outbound provider request made, or business row deleted.
The earlier independent synthetic transfer check moved 3 events with an exact payload/key match and an observed ~3.3 second manual transfer for event three; neither result establishes CDC throughput or real failover RPO/RTO.

Offline test suite covers delayed events, delete tombstones, network interruption, retry, ordered gaps, and bounded batch continuation. Must pass CI before merge.

## Required before enablement
- An authenticated adapter using constrained database identities, strict TLS, non-shared credentials, no exposure in build/client bundles, and a durable scheduled worker with supervised restart.
- Atomic per-business-transaction writer epoch/fence checking and outbox capture in every real write path, including Stripe webhooks, content delivery, memberships, inventory and Auth-derived state. **Do not** add an advisory-only toggle that can be bypassed.
- Negative SQL tests: conflicting replay, gap, expired/stale lease and concurrent writers; deletion and exactly-once state transitions; outages/timeout/restart with measured acknowledgment latency, RPO/RTO.
- Source-of-truth control during planned failover and failback, single writable database, lock-free external effect replay prevention, monitored replication lag, and real backup/restore.
- All work limited to synthetic stage until explicit production cutover approval. The Supabase development branch accrues $0.01344/hour; retire it after the tests with owner approval.
