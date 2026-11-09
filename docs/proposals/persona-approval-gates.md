# Explicit persona review generations (offline proposal)

This sibling extends the dormant delivery ledger without modifying its frozen artifact. Nothing here is a production migration, live route, paid generation, upload, provider call, or dispatch activation. The underlying bridge's hosted PostgreSQL CI passed; these NEW generation, replacement, multi-plan, and revocation races have not run in hosted CI.

## Owner-visible decisions

The review displays the actual video and exact spoken words, canonical identity/persona/rights revision, eight current-video QA records, caption, future schedule, and exact network/account/brand. It does not invent or move a past date. Missing media, failed QA, unknown rights, stale connection, or a non-script-approved draft blocks review. Script approval remains a separate prerequisite; this workflow cannot silently approve a script.

Beginning a review creates an explicit new generation with zero confirmations. Each named decision is explicit: voice/speech, final video/QA, and publication to the displayed destination/time. The API supports individual decisions and never infers one from a prior timestamp or QA pass. This is not a requirement for four separate conversations: a later reviewed UI can group clearly explicit decisions with a safely atomic protocol. This proposal does not add such a combined RPC.

After the three gates, a separate informed final delivery approval binds the execution snapshot. Nothing submits to the provider until the permanent claim and independent activation gates succeed.

## Snapshot and API contract

The immutable content snapshot has every bridge snapshot field except `approvals` and `draftRevision`. It therefore binds the script, visual brief/duration, actual media SHA-256/byte length/path, canonical evidence revision, portrait/voice IDs and rights, every QA row, caption, exact scheduled time, destination and timezone.

The expected pre-write state is exactly:
- draftRevision
- voiceApprovedAt, videoApprovedAt, publicationApprovedAt (nullable)
- planStatus
- generationId (nullable only before the first explicit review)

The trusted TypeScript adapter recomputes the content digest and the reviewed-state digest over `{content, expected}`. Thus the generation ID is included in the displayed-action digest; content hashing itself remains stable across gate bookkeeping. SQL never hashes `jsonb::text`. It compares exact content JSONB/digest, exact typed expected fields, and normalized whole source rows under the same parent-draft lock.

Service-only RPCs:
- `cs_begin_character_promo_review(p_plan_id,p_content,p_digest,p_expected,p_actor)` explicitly begins/replaces the current generation and returns review state.
- `cs_confirm_character_promo_gate(p_plan_id,p_content,p_digest,p_expected,p_gate,p_actor)` returns immutable gate evidence with generationId, gate, contentDigest, content, confirmedBy, confirmedAt, invalidated. Gate names are voice/video/publication; predecessor gates must belong to the current generation and exact content.
- `cs_read_character_promo_gates(p_plan_id)` returns generationId, invalidated, gates, hasSharedAttempt, pendingSiblingGatePlans, pendingSiblingDeliveryApprovals, and ownDeliveryApprovalCurrent. Pending sibling counts refer to OTHER plans on the same draft.

The backend derives actor from fresh verified `auth.getUser()` and a strict boolean admin claim, never request JSON. SQL independently checks the active owner allowlist and the current strict boolean `auth.users` admin metadata, by atomically capturing enabled/admin status and revocation epoch in one statement before the parent lock, then validating that exact captured epoch with status in one statement after the waited lock. Inserts store that captured value, never upgrade to an epoch fetched later. DB clock time records the actual explicit confirmation event, not a fabricated historical approval. The private ledger stores that actor/time/content evidence.

## Bookkeeping and mutation safety

Only the explicitly selected gate's shared draft timestamp and updated_at change; publication alone makes its plan ready. These shared fields are bookkeeping, not authority for another plan. Each plan must have its own explicit, scoped gate records. Gate validity uses its current generation and content/source evidence, not equality to whichever plan last wrote the shared timestamp.

The source trigger permits its own exact bookkeeping writes using an unforgeable private pending gate record, consumed once. It never trusts a custom session setting. Any unrelated draft/plan/QA write permanently invalidates the affected review evidence, including edit then revert. Changes to caption/time/destination require renewed review, never an automatic replacement date.

All actions require READ COMMITTED and serialize on the same parent draft. Gate evidence is unique per generation/gate and cannot be overwritten by repeat or concurrent requests. Unknown confirmation responses require refresh of current generation/evidence; they never confer implied consent or silently replay onto a replacement generation.

## Usable recovery without erasing evidence

Before ANY plan on the shared draft has an attempt, an explicit owner replacement archives the exact prior final approval and starts a new generation with zero gates. Old generation and gate content, actor, and time remain retained; operational invalidation flags are separate from the consent evidence. A preexisting final approval without a generation is not silently adopted or reset. No edit automatically replaces a generation, and reverting content never revives old consent.

A sibling's legitimate gate bookkeeping can stale an earlier exact final delivery snapshot without invalidating the other plan's content gates. A NEW explicit final approval can archive/refresh that stale final snapshot within the same still-valid generation, without redoing or rewriting gate evidence. Duplicate current exact final approvals remain refused. This avoids repeated cross-plan resets.

Before the first claim ONLY, every existing same-draft plan must have complete current gate work AND a current exact final approval with a valid future schedule. Unsupported, incomplete, or stale siblings are explicit blockers, never silently skipped. A first claim freezes further review/approval/source changes for the entire draft. Afterward, each remaining plan still requires its own exact current approval, active actor/gates/canon, and future schedule. Already-attempted siblings are excluded from pending sibling counts, so an earlier slot passing does not block an independently approved later plan. An unknown earlier attempt is still permanently held and can never be retried or reset. An already independently approved sibling may still claim its unchanged payload; no claim can expire, reset, or be deleted through this protocol.

## Separate sticky revocation security scope

`persona-owner-revocation.sql` is a separately reviewable OFFLINE security addition. Its production execution requires separate action-time approval, including its auth schema triggers. Approval of the original bridge or any draft PR does not cover this rollout.

- Owner enabled true to false permanently invalidates their existing review generations/evidence.
- `auth.users` admin boolean true to nontrue invalidates evidence only for existing persona owners. Unrelated metadata/account updates have no effect.
- Deleting an existing owner's auth account invalidates evidence; recreating the UUID does not revive it. Owner allowlist rows are permanent epoch tombstones: DELETE and actor UUID changes are explicitly rejected even when no evidence exists; epoch decreases are rejected. Disable via enabled=false instead. This prevents same-UUID owner recreation from resetting epoch zero beneath an in-flight first action.
- Restoring enabled/admin status permits a NEW explicit review, not revival of previous generations. A persistent owner revocation epoch increments even when there is no evidence yet; every generation, gate, and final approval binds its actor epoch. Old-epoch evidence remains invalid even if a concurrent first contribution arrived after the revocation trigger scanned its tables. Epochs are never reset on reenable or auth-account recreation.
- Attempts remain permanent. Revocation cannot cancel a provider call already in flight or an existing external schedule; manual reconciliation remains necessary.

Revocation acquires auth/owner row then affected parent draft locks in sorted order. Confirmation/claim acquire the draft lock and only READ auth/owner rows, never row-lock or update them. The action-time role check repeats after the draft lock. This avoids an introduced inverse lock order in these functions, but integration with unrelated production auth hooks still requires review. Lock waits/deadlocks fail closed; no automatic provider retry follows.

## Tests and remaining gates

Real PostgreSQL 17.11 single-user fixtures passed:
- 31 result assertions for generations, explicit gates, stale-generation rejection, exact evidence archival, edit/revert recovery, final approval and permanent attempts.
- 22 result assertions plus nine internal stage assertions for two distinct plans, stale final-approval refresh, sibling dispatch prerequisites, independent approvals and claims, shared-draft freeze, actual 62-second wall-clock expiry of an earlier attempted slot, and permanent unknown-attempt hold.
- 15 result assertions plus three expected owner-lifecycle rejection blocks for sticky owner/admin revocation, restoration, unrelated changes, account deletion/recreation, and a local fixture modeling first-ever evidence created with an old captured epoch after the revoke scan.

All three final fixture runs had no SQL ERROR/FATAL/WARNING. Shell syntax check passed. The ordinary source QA fixture defines reviewer_id as UUID without an auth.users foreign key. No production FK assumptions or production auth deletion claims are made.

No local socket/TCP workaround was attempted. The prior sandbox socket restriction remains respected.

`tests/sql/run-persona-gates-ci.sh` and the dedicated workflow prepare genuine multi-session duplicate-gate, concurrent-replacement, revocation-vs-confirmation, and first-ever-authority epoch race tests against a disposable localhost PostgreSQL 17 service without application secrets. These NEW hosted races are unexecuted. Independent review, exact-candidate hosted CI, trusted source-reader/UI integration, explicit production schema/auth-trigger approval, owner provisioning, and separately authorized provider activation remain required.

Exclude `.local-pg-gates/`, `.persona-gates-ci/`, and local helper scripts from release archives.
