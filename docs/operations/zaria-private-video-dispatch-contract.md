# Zaria private character-video dispatch contract

## Verified 2026-10-26
- Supabase draft `zaria-gallery-facebook-intro-20261025` remains `draft`, voice/video/publication approvals are NULL, and `private_character_storage.byte_hashes_verified=false`.
- Seven objects exist in private bucket `cafe-sativa-characters`; six images and one manifest.
- `lib/content/worker.ts` is a venue-room Runway worker; do **not** attach Zaria avatar production to that flow.
- `lib/content/glyph-live.ts` provides read-only canonical portrait access, not a video job queue.
- `glyph-ecosystem/services/agents/src/workflows/social-publish.ts` handles social publishing, not character media creation; Zaria is explicitly guarded.
- Queried both connected HeyGen libraries for titles containing Zaria; neither listed a resulting video. Absence of a titled video is not proof there is no unsuffixed draft.
- In this repository PR #33, `lib/content/zaria-render-preflight.ts` enforces byte-hash verification; `lib/content/zaria-render-approval.ts` enforces all three boolean approvals. These are not yet called by an active character-video dispatcher.

## Required dispatch implementation (do not run automatically)
1. Establish authoritative character-video job store: independent idempotency key `zaria-gallery-facebook-intro-20261025`; provider job ID persisted before any retries; no auto-retry of uncertain paid submissions.
2. Check signed-in owner/admin AND stored approval timestamps on the server; do not accept browser-supplied booleans as owner consent.
3. Download each required private reference and manifest through RLS/admin session; SHA-256 verify; do not make the bucket public.
4. Resolve Zaria's canonical avatar and configured Bree voice identifier without replacing with a prior audition or browser synthesis. Explicitly require canonical Gallery room master and visual sign-off.
5. Require approved provider price quote, available credit/budget, and an explicit private render authorization before submitting a paid provider task.
6. Save provider result privately; require independent image/voice/video QA and owner publication approval before creating social delivery schedules.
7. Fail closed on any provider error, hash mismatch, absent approval or missing evidence.
8. Preserve gallery candidate as unapproved; approved likeness originals must not be replaced.

This file is an implementation handoff and is **not** evidence that media dispatch is deployed.
