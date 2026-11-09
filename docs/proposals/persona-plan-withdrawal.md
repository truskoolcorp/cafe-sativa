# Explicit plan withdrawal and dispatch cohort (offline)

This is a separate local proposal in the runtime sibling. Frozen bridge/approval files remain unchanged. It is not a production migration, provider cancellation, upload, scheduled job, or dispatch activation. Apply order for isolated review is ledger → gates → owner revocation → caption/time authoring → this overlay. Production schema/grants/rollout and externally consequential actions require their own approval.

## Scope and owner choices

The owner can explicitly withdraw an unattempted plan from the required dispatch cohort. The review shows the exact target plan, network/account, caption/time and the resulting cohort. It warns that removing this requirement can make other independently approved active plans eligible. The withdrawal itself never approves a destination or calls a provider.

A target that already has any permanent attempt, including an unknown outcome, cannot be marked withdrawn as though a provider cancellation happened. The operation returns reconciliation_required with providerCancelled:false. Provider reconciliation/cancellation is outside this proposal.

A different plan's attempt does not prevent withdrawing an unattempted target. The overlay changes private control/consent metadata only, leaving all frozen public source rows, sibling approvals and permanent attempts intact. This preserves the shared draft freeze without taking away the owner's ability to stop a remaining plan.

Restore is a separate explicit owner action permitted only before ANY shared-draft attempt. It restores cohort membership, not consent. Old generations/gates/final approvals stay invalidated, and the owner must explicitly begin a NEW review generation with fresh evidence. Restore never invents a generation or approval from historical timestamps and never moves a past date. Editing caption/time on a withdrawn plan never restores it.

Withdrawal stays effective if the withdrawing actor later loses access. Revocation must never silently undo a stop. The current flag is durable state, not a computed authorization grant based on whether the past actor is still enabled.

## RPC and UI contract

All RPCs are service-only. The backend gets actor from fresh verified auth.getUser(), never from request JSON. Review/save atomically capture active owner, strict admin status and revocation epoch, then validate the same epoch after the parent-draft lock. Browser roles have no execute and service_role cannot directly mutate private tables.

Read-only GET-compatible operations:
- cs_read_character_promo_plan_controls(planId): withdrawn state, target/shared attempt metadata, and the sanitized current cohort.
- cs_read_character_promo_plan_control_result(reviewId,actor): exact immutable saved receipt for the same actor, or null while no committed receipt is known. Null is not evidence that a previously uncertain request failed; refresh/reconcile, never automatically retry save or dispatch.

Explicit POST-style operations, never GET/prefetch side effects:
- cs_review_character_promo_plan_control(planId,action,actor), action withdraw or restore: persists an opaque review ticket and returns {snapshot,digest}. Preview is not consent and does not change the cohort.
- cs_save_character_promo_plan_control(snapshot,digest,actor): consumes the exact previously displayed stored review once, changes the flag, invalidates target-only consent, and records an append-only audit event. Save must not reconstruct a review.

The review snapshot includes a random review ID, actor/epoch, action, explicit effect text, and relevant target/cohort plan fields plus control revisions. Provider receipts, signed media URLs, and credentials are not included. The digest is PostgreSQL SHA256 of its stored JSONB text, treated as an opaque token by TypeScript; it is not the JS content/approval digest. Save compares the exact persisted snapshot/digest before interpreting it.

Successful receipt includes reviewId, planId, action, withdrawn, confirmedAt, cohort, consentInvalidated:true, providerCancelled:false, dispatched:false, reviewRequired:true and generationStarted:false. Unknown save responses are reconciled by immutable review ID, never assumed successful or automatically repeated. Attempted targets return reconciliation_required; restore after sibling dispatch returns shared_dispatch_started.

## Atomicity and cohort consequences

Review, save and claim use the same parent-draft lock. Confirmation compares exact reviewed cohort membership/control revisions and relevant plan fields. It intentionally does not bind unrelated sibling attempt progression: a sibling can start while the user is reviewing, without permanently preventing a target stop.

- Withdrawal commits first: target claim returns no token.
- Target claim commits first: withdrawal returns reconciliation_required and never records a false cancellation.
- Sibling claim commits first: unattempted target withdrawal remains permitted.
- Restore loses to any shared claim: it is refused, so the frozen cohort cannot be expanded.

Only explicitly withdrawn plans are excluded from first-claim readiness. Every remaining active destination still requires its own exact current owner approval, valid gates/actor/epoch and future slot. Later independently approved active plans retain the prior permanent-claim rules. No unknown attempt expires, retries or resets.

The gate-read wrapper adds withdrawn and cohort, excludes withdrawn peers from pending counts, and reports no current delivery approval for a stopped target. Gate confirmation, generation begin, final approval and claim all reject withdrawn targets. Historical audit records are retained; no source plan or consent evidence is deleted by this overlay.

## Verification and limits

Real PostgreSQL 17.11 single-user fixtures, not fake stores, passed:
- 23 result assertions for review/save, CAS, role epochs, immutable receipt reconciliation, sticky withdrawal, authoring without reactivation, and ordinary privileges.
- 14 result assertions for an unattempted target stopping after sibling activity while an unknown attempt and frozen source remain intact.
- 17 result assertions for explicit restore, no old-consent revival, a distinct new generation and preserved old gate evidence.
- Seven result assertions for withholding dispatch until the owner explicitly excludes an unfinished sibling, without approving that excluded destination.

Counts include fixture setup assertions; ready-plan fixtures also check each explicit gate internally. All four runs had no SQL ERROR/FATAL/WARNING. Python runner invokes a fresh local postgres --single database, never a socket/network/database connection. No denied local socket workaround occurred.

The dedicated isolated PostgreSQL CI script/workflow prepares actual multi-session withdrawal-first, target-claim-first, sibling-claim-first, and old-restore-ticket versus first-claim races without application secrets. These NEW hosted races are unexecuted. Independent review and exact-candidate hosted CI remain activation gates.

Exclude .local-pg-withdrawal/ and .persona-controls-ci/ runtime evidence from release archives.
