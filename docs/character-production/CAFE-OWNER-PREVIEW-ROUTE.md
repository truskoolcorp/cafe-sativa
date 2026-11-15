# Finite owner preview and explicit submission, disabled

Base 33cb0b5e. This adds the actual protected route and owner UI using the existing authenticated transport, not a generic new approval system. No live grants, plan creation, QA changes, media generation, scheduling or publishing. Default scope is frozen, disabled, empty and has no expiry. It cannot operate until a separately reviewed real eligible plan is explicitly allowlisted with a finite expiry and enabled.

## Real record path, not synthetic metadata
Server reads exact existing delivery plan + draft and derives a minimal proposed editorial snapshot: preserve stored caption verbatim; no appended hashtags (inline tags remain); no collaborators; Facebook title exactly existing draft.title with a 100-character guard. It does not claim these derived fields were already editorial-approved. GET displays them for actual owner confirmation. No new schema or arbitrary metadata request is needed. The genuine source reader re-reads and CAS-binds all fields, verifies actual private MP4 hash, canonical identity/rights, exact Café accounts and all real attributed QA. The existing full pure candidate validator is exported and reused, not duplicated or bypassed.

Collaboration is deliberately absent in this minimal first-delivery flow, not silently stripped from a previously approved collaborator record. Any later collaborator/editorial enhancement must use verified server-owned metadata and a new exact preview. Existing unrelated legacy schedules are neither retargeted nor normalized.

## Request boundary
Canonical origin is exactly https://www.cafe-sativa.com, not request Host or forwarded headers. POST requires exact Origin, Sec-Fetch-Site same-origin, JSON content type, no query parameters, a bounded 512-byte body with only planId/digest/confirm:true. GET only takes the configured plan ID. Actual cookie session must resolve the exact corporate owner with strict app_metadata admin true. No service-key mutation fallback. Admin-key access is read-only for source/media verification.

GET validates and displays a preview, never calls recording or constructs owner authority. POST re-loads all genuine sources and recomputes digest. Drift returns conflict. Only after actual explicit confirmation does it use recordConfirmedPreview and the database's authenticated-owner wrapper. Approval is finite (at most 15 minutes, configured window and schedule-minus-one-minute), insert-once and source-CAS bound. It is not a publication or scheduling receipt.

UI has distinct Review and Confirm buttons, no automatic POST; immediately latches submission even on network failure. Unknown outcomes tell the owner to reconcile existing records read-only, not retry. Server transport also latches its RPC; SQL permanent plan uniqueness protects across instances. Future retries after stale-preview rejection still require deliberate reconciliation/review, not background replay.

## Provisioning and remaining blockers
1. A genuinely new, correctly mapped Café plan must already exist with clean finalized media and real required QA. Existing external-receipt promos are blocked by the repaired replay guard.
2. Verify proposed editorial fields and exact candidate using the read-only source checks. Do not invent test IDs, QA or metadata evidence to populate scope.
3. Review the actual finite allowlist/expiry and installation of the authenticated-owner SQL capability; code merge alone does not apply it.
4. Enable only that finite scope. Owner reviews and explicitly submits, then inspect durable authority before separate dispatch.

Current empty scope honestly reports disabled/not-ready. This is a finite first-delivery path, not unattended policy recording. Scheduling and publication remain separate operations; steady-state automation is not claimed complete.

Seven local route/editorial tests pass: disabled zero access, GET zero writes, exact confirmed POST, origin/CSRF/extra fields/foreign plan denial, drift/missing QA/nonowner denial, bounded bodies and source-derived metadata. CI must run project strict TS plus all existing regressions. Mock handler tests do not replace real media QA or production delivery proof.

The preview labels the finite submission window separately from the actual approval expiry. A successful POST displays the server-returned approval expiry (minimum of window end, 15 minutes, and scheduled time minus 60 seconds). A synchronous client ref latch and sessionStorage marker keyed by plan/digest prevent duplicate clicks and blind retries after refresh in the same tab. Storage failure prevents submission. This UI protection is not a cross-tab security boundary; permanent database uniqueness remains authoritative.
