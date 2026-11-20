# Future one-off private test: offline implementation

Offline SQL/runtime and rehearsal tests accompany this proposal. No live authority or execution is approved or created by preparing them. Do not reset the frozen attempt, change its budget, replace the original preparation binding, use a fabricated daily key, or bypass the current Dallas-day checks.

## Preferred path

Earliest candidate is November 17, 2026 in America/Chicago, not an approved execution date. Earliest ordinary unused date is November 17, 2026, subject to live admission checks. Obtain a specific future Dallas calendar date and finite same-day deadline. Use that date's normal `daily:YYYY-MM-DD:zaria-solenne` key. Require that no attempt or occurrence already owns it. Existing `text_claim`, `text_authorized` and speech-source cadence validation remain unchanged. A same-day nonce namespace would require widening core invariants and is rejected for this test.

## Additive objects requiring review and approval

- One new capped text budget: maximum and total cap an ADDITIONAL $0.10 beyond the existing reserved $0.10, current verified model/rates, finite expiry, zero starting reservation. Never replenish/refund the old budget.
- One immutable finite-test authority row containing approved owner-message IDs, current admin actor, exact future date, deadline, approved source scope, budget ID and speech scope ID. Only monotonic disable is allowed.
- A separate immutable named finite-test binding and one occurrence row with unique normal daily key. Do not modify existing original preparation binding or occurrence.
- Narrow `finite_test_context()` / `finite_test_claim(occurrence, phase)` functions. They validate approved date, current Dallas date, deadline, live admin/authority and exact immutable identity; claims are once-only and monotonic. No caller-supplied source scope, successor, reset or retry path.
- A private speech-source reader bound to the new immutable finite-test speech scope and exact persisted text identity. Do not replace the existing speech binding (its trigger revokes the previous scope). Bree speech at most 250 characters, included credits only, no paid overage; recheck availability immediately before dispatch.
- A finite admin-only empty-body endpoint compiled for the specifically approved date/deadline. All feature flags stay off until deployment, preflight, security approval and spending scope are verified. No recurring scheduler or publication/video route.

## Order

1. Deploy and rehearse checkpoint writing/readback first. Checkpoint recovery only re-parses and reviews saved content; it cannot dispatch a provider or approve generated output.
2. Review the exact SQL, role graph and effective writer/reader principals. Obtain action-time approval for new security grants, plus explicit approval of the new test date, expiry and aggregate spend.
3. Install the bounded new authority, verify no existing key/receipt, verify current canon/voice and available included credits, then enable only the finite adapter.
4. Perform at most one text provider dispatch. Require immutable content checkpoint before editorial parsing. Speech follows only a successfully saved, exact private text identity under its own once-only claim.
5. Close flags immediately after outcome. Preserve all claimed/unknown states and their evidence; no automatic retries, refunds, regeneration, publication or extension past expiry.

## Retention and privacy

Checkpoint content is private generated provider content, not just metadata. Readback also includes its original stored source context (canon, programming and recent scripts) for provenance checks. No prompt, HTTP headers, credentials or raw error bodies are retained. The read RPC adds a real content-access capability to the reviewed service-role effective principals, including indirect managed Storage access. Proposed review after 30 days is not a promise to purge: append-only evidence needs a separate owner-approved retention migration. Metadata-only receipts may remain longer for reconciliation.

## Required admission tests before installation is ready

Reject wrong day, before authorized time, after expiry, non-admin/revoked owner, disabled lane, altered source/budget/speech scope, wrong occurrence, occupied daily key, already-claimed phase, missing or mismatched persisted text identity, unavailable included quota and overage. Race two admissions and prove one claim. Prove existing frozen rows and reservations are byte-for-byte unchanged, no original binding mutation, and no SQL path creates a successor or releases funds. Verify both phases stop at expiry and source changes fail closed. Test exact endpoint origin/empty body/admin/timeout guards. Deployment and security approval are separate from a test-date and additional-spend approval.

**Readiness:** Offline SQL and runtime implementation now exist. The generic `character-production-finite-test-nov17-install.sql` creates three narrowly granted RPCs and no budget/authority. The separate `character-production-finite-test-nov17-enroll.sql` contains an unfilled future-approval message placeholder and refuses execution outside the Nov17 window. Serial PG17 full-flow rehearsal uses an explicit test-only simulated clock; eight-caller concurrent admission is tested by the server-mode CI branch. Independent review, CI results, future action-time security approval and exact additional-spend/date approval remain required. Approving the checkpoint alone does not authorize enrollment or execution.
