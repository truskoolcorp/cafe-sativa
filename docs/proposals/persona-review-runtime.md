# Dormant persona review runtime

Local proposal only. `CS_PERSONA_REVIEW_RUNTIME_ENABLED` is absent/false by default. No dispatcher, cron, provider upload, signed media URL or scheduling action is exposed. Merging this increment does not make persona scheduling runnable.

## Operator activation boundary

Before enabling the server flag, separately review and approve production application of **all** SQL proposals in dependency order: delivery ledger, approval gates, sticky owner revocation, caption/time authoring, exact-hash QA observations, then plan withdrawal/restore. Verify actual production schema parity, restrictive function grants, owner allowlist, immutable authority epochs and auth-trigger installation. Gate RPC presence alone is not evidence sticky revocation is installed. This increment has no automatic migration/capability attestation; the complete rollout prerequisite remains unverified and activation is blocked until an operator verifies it. Do not apply any proposal merely because a route exists. Enable only after full hosted CI and independent review. The separately scoped owner/auth security changes require explicit rollout approval.

Existing destination mappings remain Keith → verified Tru Skool brand 5373515 / user 4174093, Facebook 146219355471397 and Threads truskoolcorp. No Café-brand or Instagram authorization is added.

## Routes and review surface

`/admin/programming/character-promos/review` requires current server-authenticated admin identity. API review, review-media and review-action routes fail closed before constructing clients when disabled. Actions require same origin, bounded JSON and an explicit action; body-supplied actor/destination is rejected. Each mutation refreshes identity and executes one call without retry. SQL owns row locking, exact expected-state checks and durable evidence.

The candidate view is explicitly **not an approvable snapshot**. It shows actual script and finalized private MP4 hash/bytes even when caption/time/QA are absent. Missing values stay missing. MP4 preview streams only authenticated, current exact-hash bytes with private/no-store headers; no URL signing or third-party upload occurs. A Blob size limit prevents a further arrayBuffer copy, but Supabase download may already buffer the response: this is not a bounded transport guarantee. Sequential source rereads detect observed differences, not ABA or all interleavings. Final write authority is the atomic SQL ledger. Candidate/model script, revision, media, QA and destination data must match before approval controls are exposed; the client also rejects mismatched preview identity.

Caption/time editing is accessible before QA readiness. A persisted opaque proposal binds the immutable destination, current plan/draft, actor/epoch and proposed caption/time; a second explicit action saves exactly that proposal. It does not approve or dispatch. Source consent invalidation is retained, and edits are blocked after a shared durable attempt. Existing plans are selectable; creation of new plans or remapping accounts is not implemented here.

QA records explicit user-selected pass/fail/needs_review plus evidence against the viewed SHA, draft revision and full prior observation (or exact absence). Private bytes are reverified, then a fresh admin actor is checked. Observations preserve the existing admin role scope, not the narrower owner allowlist; only commit-time strict admin validation is promised for non-owner QA, not sticky non-owner revocation history. SQL serializes on the parent draft and rejects stale media/revision/CAS and shared attempts. No observation grants final content approval. With the feature flag enabled, the legacy qa-checks POST delegates to this exact contract; missing identity is rejected and old clients are directed to this workflow. With the flag disabled, the existing production behavior is unchanged. Existing media-upload/upload-finalize integrity writers remain byte-verified machine `mp4_integrity` observations. Historical/manual observations are not retroactively asserted to have new exact-view CAS provenance.

Voice, video and publication decisions each require explicit current owner confirmation for the exact plan/generation/content. Final delivery approval is a separate explicit action. Legacy timestamps never substitute for immutable gate evidence. All target hashes, real script, canon payload revision, current-video eight QA observations, caption/time and exact account remain bound.

Withdrawal/restore is separate two-stage explicit review/save against a persisted cohort snapshot. Removing a prerequisite may make other independently approved plans eligible, but neither review nor save dispatches them. Withdrawal can stop an unattempted target after a sibling has claimed. An attempted or unknown target cannot be cancelled through this interface and requires provider reconciliation. Restoration is only before any shared attempt, invalidates prior target consent and requires a new explicit review generation. An uncertain save is reconciled by read-only receipt lookup, never automatically retried. A receipt proves that historical action committed, not current withdrawn state; reload the current cohort afterward.

## Existing connection and canon reads

The server reads the existing encrypted Metricool connection and validates owner/status/exact brand/user, token type and expiry before opening a fresh read-only session. Only getBrandSettings is called. It does not use withSocialConnection, refresh tokens, save credentials, acquire provider write locks or mutate connection logs. Expired/near-expiry tokens produce a reconnect blocker. Authorized reconnect is a separate task, not a silent side effect. Fresh GLYPH source data supplies canonical context/status and the full relevant payload fingerprint; rights_status is an upstream assertion, not independent license documentation. Current-video rights QA and explicit owner approval remain separate.

## Remaining work after code review

- Apply and verify the independently approved DB/security rollout, then deliberately enable this admin review surface.
- Obtain actual user observations and explicit owner voice/video/publication/final delivery approval for exact current assets and each desired destination. Engineering rollout cannot grant these.
- Supply real captions and future UTC times. Resolve actual missing QA/canon/rights or connection evidence; no automatic PASS or placeholder approval.
- Implement/review a separate server-only executable dispatcher/runner and its activation policy. Existing dormant engine/adapters are not called by these routes. It must preserve atomic permanent claims, one-shot uncertain outcomes, scoped approved-byte transmission, session deadline sequencing, truthful scheduled receipts and no retry after uncertain provider writes.
- No recurring generation, automatic reapproval, new-plan creation, destination remapping or provider cancellation is implemented.

## Validation scope

Local CJS tests include DI HTTP/source/QA/control adapters and a React hook interaction harness (not visual browser testing). SQL single-user PG17 fixtures and genuine hosted multi-session harnesses are separate evidence: prepared hosted races are not counted as executed until CI actually runs. No production service or provider was used for validation.

Database draft revisions and gate approval stamps preserve PostgreSQL microsecond precision through reader, candidate view, next-gate CAS and final snapshot. They are not rounded through JavaScript Date. Provider schedules deliberately require lossless millisecond precision; a stored sub-millisecond schedule is displayed unchanged but blocks readiness until the owner explicitly authors and saves a supported exact UTC time. SQL equality and stored timestamps remain unchanged.
