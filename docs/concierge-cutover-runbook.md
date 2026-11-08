# Text concierge cutover and reconciliation

This is a release checklist, not a command to apply production SQL or enable paid traffic. The final migration, privileges, cleanup policy and activation settings require their applicable approvals. Keep the Hit Em event page, calendar, embedded video and shared YouTube chat available throughout.

## Evidence and limits

- Current production at the last verified check was `68d50d2c6f4c11419206f4c710dc977630aa48a4`, deployment `dpl_GZzTWrCmqbAc8J9x4EAsFwgPkz1v`.
- The Vercel project already reports SSO protection for `all_except_custom_domains`. Anonymous read-only GETs on November 8, 2026 reached the application method boundary at `www.cafe-sativa.com` and `virtual-cafe-sativa.vercel.app`; the bare domain redirected to `www`.
- The team alias, main-branch alias, current generated deployment URL and immediately previous generated deployment URL redirected to Vercel SSO. No login, access token, share link or protection change was used. A GET protection sample does not prove every historical deployment, authenticated caller or POST path is blocked.
- The deployment catalog sample contains the latest 100 ready production deployments, with older pages remaining. Do not treat that sample as a complete inventory or delete historical deployments as a shortcut.
- Repository source identifies `/ask` as a text caller and advertises `mall-3d` and `email` request surfaces. It does not prove all external integrations have been inventoried. LiveKit voice session/memory and speech endpoints are separate and are not covered by the text spending cap.
- The deployed Mall client at `truskoolcorp/tru-skool-mall` commit `bb1a25c3321e55cfd5ed7a058c33d85c18da5726` calls this API without `request_id`, `issued_at`, a retained body or status recovery. It masks errors with canned replies and does not handle a pending response. Enabling durable mode before updating that caller would break its real conversations. Its separate, unused-by-the-inspected-UI `api/chat.js` directly invokes a provider outside this ledger; runtime reachability and credential configuration were not tested. Include it in the legacy entry-point inventory without executing a paid call.

## Required release order

1. Freeze the reviewed source, SQL and configuration hashes. Recheck the production schema and active deployment. Understand whether the connected Supabase Git integration applies migrations at merge time. Never merge a migrations-directory change before the exact database action has been approved.
   - Stage a separately reviewed, no-migration capability/recovery preparation release before deploying dependent external clients. Verify the explicit disabled-mode capability contract, then deploy and test the Mall retained-request/status-recovery client while admission mode remains off. A missing capability endpoint is not permission to guess the mode. Resolve the Mall's alternate provider handler and all other legacy entry points before durable activation. Do not make client publication silently depend on applying this migration.
2. Prepare a separately reviewed text-only maintenance release, without applying the durable migration as a side effect. Deploying an environment flag alone does not change already-built deployments. Verify the maintenance version serves every public application alias, including the default `vercel.app` alias, while the event/player/calendar still work.
3. Reject new text submissions before auth, quota, history or provider work. Keep status reads and already-running completion/reconciliation available. Suppress missing-key admission recovery while paused. Clients keep their original retained request; they must not replace it with a new ID.
4. Verify old generated deployments and alternate domains cannot accept legacy calls. Existing Vercel protection can help, but authorized team sessions, automation tokens and deployment bypasses can still be relevant. Inventory approved callers and stop their legacy submissions. Any needed protection/firewall change requires its exact action-time approval; do not create a bypass link.
5. Drain already-started legacy operations. A local timeout or wait of 25 or 60 seconds is not proof that the provider terminated. Use available operational/provider terminal evidence and aggregate stored-turn observations. If a previous call cannot be reconciled, keep text paused rather than declaring a clean drain. Do not inspect unrelated private conversation content.
6. Only after drain evidence and isolated Auth/writer integration verification, apply the approved migration with admissions disabled, validate real roles and normal account/commerce behavior, and deploy the compatible durable worker. Approval must explicitly include two auth.users statement guards, one Lounge UPDATE guard and early locking in the three existing commerce RPCs, which now share the two-second global-lock contention boundary. Use the Auth service for deletion; do not replace its lifecycle/storage checks with direct SQL. No real-user deletion is an acceptance test. All aliases must use the reviewed worker. Set the database-clock legacy cutoff only when the actual drain is known.
7. Configure only approved policy values. An unconfigured or invalid policy stays closed. Enable admission last, then run a small pre-approved synthetic acceptance test. Test deterministic facts, a real general conversation, continuation, two simultaneous distinct requesters, same-ID response recovery, busy behavior, and cross-account rejection. No real-user deletion test belongs in production acceptance.
8. Record the exact production deployment and policy revision, aggregate outcomes and remaining limits. Do not call a two-request test a crowd-capacity certification.

## Provider outcome classification

| Evidence | Permitted accounting/lifecycle action |
| --- | --- |
| Reserved, and dispatch was never granted | Cancel and refund under the ledger lock. |
| Dispatch grant response was lost, network error, local abort or timeout | Unknown. Keep charged and occupying capacity; do not call the provider again. |
| Provider returned a successful terminal response and completion transaction is confirmed | Return the one cached completed response; repeated requests do not dispatch. |
| Provider returned a successful terminal response, completion retries failed, and a final status read does not show completed | A charged terminal failure may close the request, but only on a verified finish/status acknowledgement. The finish RPC must preserve an already-committed completion. |
| Terminal provider error proven by a provider receipt or documented endpoint result | Operator may use the reviewed charged-failure path after checking the exact ledger key. An arbitrary HTTP error is not automatically this evidence. |
| Time elapsed, budget window advanced, or no record was found in a short-retention log | Not terminal evidence and not permission to refund, purge, or repeat dispatch. |

Receipts must be allowlisted and bounded: provider request/message identifiers and integer input/output token counts only. Never include prompts, replies, credentials, user/session identifiers, owner capabilities or raw exception bodies. A receipt proves only what its producing path actually observed. It is not provider invoice reconciliation.

Before activation, assign a reconciliation owner, verify access to the relevant provider/account evidence, and document receipt/log retention. The candidate does not create an autonomous operator, provider cancellation service or a dashboard that proves all unknown calls terminal.

## Retention operations

The timestamp in a version-2 request is bound to its immutable UUIDv7 key. A monotonic rejection watermark must be committed under the same lock before a terminal key can be pruned. Increasing a later policy horizon must never make an old deleted key admissible again.

Cleanup must be bounded, explicitly configured and reviewed. Redact private ledger content on the approved content horizon; preserve only necessary accounting/replay material until terminal rows are outside every applicable horizon. Unresolved work may be redacted/quarantined without refunding or freeing capacity, but it must never be silently purged or redispatched. This ledger lifecycle does not change existing conversation-history retention or satisfy all account-erasure requirements by itself.

No scheduled cleanup or production deletion is installed by this document. Test the exact proposed schedule and permissions in isolation before requesting activation approval.

## Safe stop and rollback

Disable new admission while preserving durable status, completion and reconciliation. Keep the event and YouTube audience path available. Do not switch durable mode off, promote the legacy worker, refund unknowns, drop guards, or delete ledger keys as an automatic rollback.

A post-commit schema/privilege rollback is a separate reviewed action. Preserve accounting and idempotency evidence. Return to legacy only after every durable request is terminal and compatibility is verified; otherwise leave text paused and report the blocker.
