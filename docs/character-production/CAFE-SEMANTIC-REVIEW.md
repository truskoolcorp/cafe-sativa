# Dormant recurring Café semantic review

No default budget, runtime grant, route or provider invocation. The Anthropic adapter reuses the existing key/SDK and pinned Haiku model; it does not reuse expired YouTube quotas or HeyGen funds. The SQL is a rollback-ended proposal, not a drift-safe production installer.

The full exact request includes system, tool schema, tool choice and frozen content. The official count endpoint is free but produces an estimate, not a billing guarantee: https://platform.claude.com/docs/en/build-with-claude/token-counting . Therefore reservation uses a separately verified maximum billable input-token ceiling, not the estimate. Missing actual account/rate evidence, owner cap, ceiling evidence or counting permission denies all provider operations. No pricing values are populated by this patch. The fixture's 100-token budget is synthetic database-test data only.

Atomic reservation locks one budget and inserts a globally unique content-review key before inference. The whole upper-bound charge remains reserved on failure/unknown; no refund/reset/retry API exists. A duplicate digest cannot invoke inference again. Token counting may repeat before the duplicate reservation is denied; it never generates content. Server token-count/key binding is a trusted adapter boundary, not independently proven by SQL.

Successful provider responses must have a real message ID, pinned model, bounded usage and bounded structured result. An insert-once durable receipt records those fields, result hash and classified response; absent or unconfirmed persistence never issues assessment. Unknown provider/network results leave the consumed reservation without a receipt; reconcile read-only, never resubmit. Recorded usage is not actual invoice reconciliation. No automatic refunds or resets.

The semantic result is not media QA, rights verification or publication authority. The enrolled authority transport separately runs existing full source/media/canon/QA validators and sends only the scoped five-argument RPC. SQL must derive owner and current publication policy/enrollment, including later dispatch revocation. No supplied actor/policy fallback.

Local unit tests cover provider-free defaults, exact immutable input, risk/malformed rejection, real-result identity, persistence failure and scoped RPC shape. PG17 fixture covers no budget, denied roles, concurrent duplicate attempts, cap, durable holds, receipt insertion and revocation. Actual CI is pending; no claim of PostgreSQL execution locally.
