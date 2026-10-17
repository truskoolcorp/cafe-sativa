# Replication supervisor implementation and production release gate

## Sandbox implementation
- `scripts/replication/supervise.cjs` runs bounded checkpoint-driven cycles with transient failure backoff, graceful abort, on-cycle feedback; requires explicit `CS_REPLICATION_SANDBOX_ENABLED=true` and `isolated-*` stream prefix. **No live database credentials, adapters or always-on deployment were installed.**
- `database/replication/002_per_stream_sequence.sql` repairs a real multi-stream bug in the original outbox: a global identity prevented contiguous per-stream replication. Migration allocates sequence numbers while updating the stream lease row. Tested Neon staging independently for `isolated-v2-a` = [1,2] and `isolated-v2-b` = [1].
- Source lease/epoch checks protect only `append_event`. They do **not** fence existing Café Sativa application writes, Stripe RPCs, storage or provider side effects. The desired atomic write+outbox contract is not yet implemented.
- Offline fault suite checks disabled default, production-stream refusal, retry from checkpoint, delay, delete, replay, and sequence gaps.

## Not certified or deployed
A cloud worker requires separately scoped credentials and adapter plumbing to Neon staging and Supabase **test** branch, a defined owner/service/environment and resource cost, then actual health/restart tests. Existing Railway projects belong to unrelated products and must not be reused without explicit selection. The existing Café Sativa website is on Vercel, currently Supabase-primary. No production connection changes were made.

Application-wide writer fencing requires changing every business mutation to an atomic, authenticated, epoch-fenced RPC or database trigger that can enforce lease ownership without caller-forged settings, and removing direct bypass grants. Simply checking a fence from a Next.js API handler before a write would allow races and is insufficient. Until every path, including auth-triggered and webhook transitions, is covered, **fail closed** at production cutover; don't enable Neon-primary.

Real cross-provider RPO/RTO, failback, external event dedupe and network partition safety require a live sandbox worker and repeated timed outage tests. Results from earlier manually orchestrated transfers cannot certify unattended replication.
