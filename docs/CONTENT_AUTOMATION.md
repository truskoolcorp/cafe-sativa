# Café Sativa virtual twin content operations

Owner instruction, 7 October 2026: maximum automation, actual canonical references,
photorealism and accuracy. Owner-selected generation budget: **$25 per calendar month**.

## Implemented in this branch

- Cron plans Monday/Wednesday/Friday venue shots. Slot keys prevent duplicate plans.
- Worker submits only a versioned, approved, checksum-verified room keyframe.
  It submits verified image bytes, preserving reference integrity.
- The database atomically reserves a conservative all-in quote before a paid call.
  $25 is enforced across concurrent workers in America/Chicago calendar months.
  Failed or uncertain submissions retain reservations until manually reconciled.
- No paid automatic retries, invented people, invented events, or opening claims.
- Provider task IDs persist; successful video is copied into private durable storage
  and held at `pending_qa`. Approval and social delivery are **not yet implemented**.
- Content-admin Airtable reads and writes require a server-authenticated account
  with `app_metadata.cafe_sativa_admin=true`; browser metadata cannot grant access.

## Current observed state

- Repository: `truskoolcorp/cafe-sativa`.
- Vercel: `virtual-cafe-sativa`, project `prj_x7gIEqL9s0si4RwIOFYDHtZEq71w`.
- Supabase `cafe-sativa-prod` (`nwfxvhqbjtfvoopcadff`) is ACTIVE_HEALTHY after
  transfer to the owner-approved TS_Empire Pro organization. No other project was paused.
  The content migration is applied, RLS is enabled, and the private 50 MiB output
  bucket exists. The canonical registry is empty.
- The automation branch is deployed to production. Authenticated planner verification
  created `2026-10-07:bar`; anonymous cron access returned 401. The worker returned
  paused as intended. No video was generated or published.
- Production has CRON_SECRET and generation=false. RUNWAYML_API_SECRET and a
  verified five-second cost quote still need configuration.
- Airtable `appOKiDIBrgayTVW5` has Content Calendar, Generation Log, Publish Log,
  Weekly Brief, and Settings. Eight inaccurate unpublished June captions were corrected;
  their original drafts were retained in Approval Notes. Nine calendar drafts were
  prepared for October 12, 14, 16 at 7 PM Chicago, across Instagram, TikTok and X.
- Existing `public/rooms` and `public/hosts` images are candidates, not automatically
  owner-approved canonicals. April architecture references the mall's versioned geometry;
  this must be reconciled with the room render references before identity/layout approval.
- The old Schedule → Runway Zap has no job input or request body. It has not been repurposed.

## Activation sequence

1. Supabase restoration is complete on the owner-approved Pro subscription.
2. The content migration is applied to cafe-sativa-prod.
3. Create `cafe-sativa-canon` storage for approved public venue image references, and
   retain the existing private `cafe-sativa-content` output bucket. Upload immutable versioned keyframes;
   record their exact SHA-256, version, subject/room, owner approval and timestamp.
4. Confirm the server environment has Supabase URL/anon/service keys, `CRON_SECRET`,
   `RUNWAYML_API_SECRET`, and a verified conservative
   `CS_RUNWAY_FIVE_SECOND_QUOTE_CENTS` for gen4.5 / 5s / 720:1280, including all applicable costs.
   Enable `CS_CONTENT_GENERATION_ENABLED=true` only after checks pass.
5. Set owner account admin metadata using the trusted Supabase admin surface; retain
   the existing owner identity. Verify anonymous and ordinary users receive 401.
6. Deploy this branch and run cron/worker in a preview first. Cron is at 05:15 UTC daily;
   worker at 05:30 UTC. Local slot selection handles Chicago daylight saving changes.
   Daily worker polling is a low-cost initial cadence, not real-time delivery.
7. Build authenticated QA/review with signed output previews, logo compositing, approved
   character/voice registration, reusable media library selection, caption validation,
   and verified channel scheduling with idempotent delivery receipts and publish logs.
   These are required before full automatic publishing can be enabled.

## Accuracy acceptance

Compare each shot against the approved keyframe: geometry, furniture, lighting,
skin/anatomy when talent appears, wardrobe, logo fidelity, voice, and visible text.
Style prompts cannot guarantee exact twins. A measured reference comparison and
review of the first approved reusable clip in every room remain necessary.
Physical Tenerife location/opening details stay explicitly future/planned until confirmed.
Do not use a schedule timestamp as a Runway URL or an old placeholder event as a real event.

## Source review, 7 October 2026

Two source layouts conflict and neither is registered as approved:

- Drive `1SbDG-2y5hajX3EPfhHuo-PR3sWaFfVWU`,
  `Cafe_Sativa-FloorPlan-1.webp`: rendered overhead layout with a curved central
  bar, performance lounge, gallery, kitchen, courtyard and cigar lounge.
- Drive `1N6isMez-MP-pDTaphkBciAivtQMWlBZ3`,
  `Cafe_Sativa_Pitch_Deck (1).pptx`, slide 6 / media image18.jpg:
  a different rectangular floor plan with numerous private smoking rooms and
  a central stage. Its scale labels appear inconsistent; no measured dimensions
  have been independently verified. The deck describes a 4,700 sq ft concept.

The deck's venue photos vary substantially in design and do not establish a single
room-by-room twin. Existing website venue/bar/gallery images contain people and
are not empty-room geometry keyframes. Do not automatically approve them for
room-only generation. Recover final approved geometry and room views before
activating the worker. Runway workspace discovery stalled and was interrupted;
no workspace plan, API funding or usable provider credential was verified.
