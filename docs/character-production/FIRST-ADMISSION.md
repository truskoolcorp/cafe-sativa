# First original speech to production enrollment

Source-only, dormant, first occurrence only. No route, cron, grants, owner rows, provider writes, or activation is installed by this change.

## Executable chain

`createCafeFirstAdmissionOperation().run(signal)` accepts no caller identity, script, candidate, image, policy, timestamp, or storage URL.

1. Read the two-RPC capability's fixed owner context. SQL retains original occurrence and allocates one enrollment ID, draft ID, and generation timestamp once.
2. Recover and verify the original persisted text-bound private speech claim, provider receipt, receipt, and actual audio bytes. An expired original speech authorization is never reused to synthesize.
3. Construct the existing image/audio binding and immutable snapshot from that receipt and the current owner-configured image, account, rights and quote. Reject audio longer than the reviewed quoted duration. Do not truncate audio or relabel measured duration.
4. Run existing current planner policy, live canon, account and actual private media validation. Re-read fixed context before admission.
5. Admit exactly one full serialized `TrustedPlannerManifest` and its scheduler candidate atomically. An unknown response is held, not retried.
6. On a later call, read the original accepted manifest and use the existing `createPlannerEntry` scoped adapter and bound planner. The original manifest's hash, IDs and source snapshot are retained. No duplicate intro, binding replacement, or successor is created.

The factory remains off unless `CS_CHARACTER_FIRST_ADMISSION_ENABLED=true`. This is not an installed end-to-end pipeline. The existing generation/collection/QA/dispatch paths still require their separately reviewed current authority, bindings and live data. Enrollment is not generation or publication.

## Authority and access

Proposed owner-only SQL creates fixed configuration and retained first-admission records, two narrow RPCs, and one-way revocation propagation. Disabling the owning preparation lane or first-admission configuration must revoke only its admitted scheduler enrollment; existing revocation then disables its slots/QA. Nothing re-enables revoked work.

The server uses the existing admin transport with explicit new RPC names. A live service-role EXECUTE grant would be a new material authority to admit that one configured scheduler candidate, including any inherited Storage-admin role path. No such grant is included here. Existing planning-policy read and scoped scheduler reads/writes must also be available; no generic planner fallback is used.

The source SQL only binds submitted receipts and hashes. Actual Storage bytes/receipt-chain/canon checks occur in the trusted server operation. Neither preview nor hashes alone confer semantic QA or publishing approval.

## Required genuine inputs

- The owner-configured retained preparation lane and completed original text attempt.
- Original successful private speech receipt and bytes, not reconstructed claims.
- Current exact canonical Zaria/approved Gallery image and voice binding.
- Current reviewed account, quote ceiling and planning policy with real monthly budget.
- No existing scheduler binding for another enrollment. That condition holds rather than automatically replacing previous introductions.
- Current finite generation target. Missed targets hold without rewriting timestamps.
- Applicable live access approval before installation or execution.

## Evidence boundaries

Unit tests mock network/provider/DB boundaries around the actual server composition. PostgreSQL rehearsal uses synthetic isolated fixtures and real SQL constraints. Neither is evidence of a real generated video, successful publication, live installation or runtime activation.
