# The Stage — production and automation contract

Status: owner-approved creative and operational direction, 19 November 2026.

## Purpose

The Stage is Café Sativa's interactive entertainment and social-commerce venue. It is not a passive video gallery. Each program combines a credible show, moderated audience participation, contextual discovery, commerce or artist conversion, durable publication receipts, and a replay experience.

## Initial program pillars

### Scripted stand-up comedy

- A comedian performs on the canonical Café Sativa stage before a believable audience.
- The show may be live or clearly identified as a prerecorded premiere.
- Supported interactions: moderated chat, reactions, highlighted questions, audience prompts, tipping when enabled, performer profile, follow links, and replay access.
- Scripts must not imitate a living comedian or reuse protected material without permission.

### Virtual fashion shows

- Models may enter through the audience, courtyard, or beachside terrace; walk a practical path to the stage; pose; and exit naturally.
- Initial merchandise is limited to approved Tru Skool brands and exact available products.
- Time-coded product cards must identify the exact garment, price, availability, sizes, colors, storefront, and source scene.
- Approximate products, invented variants, altered logos, unavailable boots, false inventory, and visual substitutions are prohibited.
- Later affiliate products require approved partner identity, tracking parameters, commission or revenue-share terms, disclosure, and settlement evidence before publication.

### Virtual concerts and listening events

- The concert format is artist-agnostic and supports a growing roster of Café Sativa, Tru Skool, affiliated, independent, and guest artists.
- **Debut program:** Ahnika performs \"Already Gone\" on the Stage with canonical likeness, wardrobe, audio, lipsync, staging, band/production context, and audience behavior. This is the launch example, not an exclusive or permanent limitation.
- Calls to action may link to approved listening, viewing, song/album purchase, artist follow, membership, ticket, and merchandise destinations.
- Music ownership, synchronization, performance, visual, and distribution rights must be recorded before publication.
- A prerecorded performance with live chat must be presented as a premiere or replay, never falsely described as live.

### Live-streamed real-world events

- The Stage also serves as the virtual broadcast venue for approved real-world productions such as community BBQs, festivals, concerts, pop-ups, cultural events, panels, fashion events, and community programs.
- A live event may be streamed to the Café Sativa Stage while remote viewers participate through moderated chat, reactions, questions, polls, registrations, donations/tipping, artist links, product cards, and membership or ticket actions.
- The stream experience requires an event-specific run sheet, producer/moderator roles, tested ingest and backup feed, connectivity health checks, stream delay policy, music/appearance/location permissions, emergency stop, chat moderation, accessible captions where practical, and a recorded fallback or holding screen.
- The site must accurately distinguish **live now**, **scheduled**, **premiere**, **replay**, **interrupted**, and **ended** states. A prerecorded or delayed feed may never be represented as live.
- If the primary stream fails, the venue should preserve chat state where safe, show an accurate interruption message, attempt only approved bounded failover, and reconcile the recording before publishing a replay.
- Real-world programs may create simultaneous in-person and virtual commerce, registration, sponsor, affiliate, artist, and membership opportunities; each uses the same exact-destination and attribution controls.

### Additional approved formats

Spoken word, THE Verse Alkemist performances, DJ showcases, interviews, listening parties, sponsored showcases, community BBQs, festivals, pop-ups, and approved outside artists or designers may use the same controls.

## Debut visual language and supplied references

Owner-supplied references on 19 November 2026 establish the intended Ahnika debut visual language:

- intimate, premium lounge performance rather than a generic arena;
- warm amber and practical candle/table lighting with controlled dark backgrounds;
- close audience proximity and believable seated sightlines;
- shallow depth of field and cinematic contrast;
- a clear stage while retaining the Café Sativa relationship to audience, lounge, courtyard, and beachside terrace;
- coverage that alternates establishing wide, performer medium, emotional face/microphone close-up, instrument/hand insert, audience reaction, and environmental transition shots;
- natural, emotionally credible performance energy instead of exaggerated avatar gestures;
- Ahnika's canonical face and light-hazel eyes must remain stable across every angle.

Reference classification:

- `Ahnika_Merlot_on_Stage-CS.png`: still-image visual target for intimacy, lighting, audience distance, table practicals, guitar, and performer framing; it is guidance, not automatic publication approval.
- `Ahnika Merlot Already Gone_6398(2).mp4`: 30-second 1920×1080 visual/editing reference. It visibly contains an MVLAND watermark and is therefore prohibited from publication; use only for shot-language guidance.
- `Ahnika Merlot Live Performance(3).mp4`: 8-second 1280×720 performance candidate/reference. Publication requires exact likeness, hazel-eye, rights, audio, lipsync, artifact, watermark, and source/export verification.
- `Ahnika_Merlot_at_Café_Sativa(1).mp4`: 10-second 1080×1920 vertical host/promo candidate/reference. Treat as short-form supporting material, not the full concert master; publication requires the same checks.

The debut master should be composed in 16:9, with separately reviewed 9:16 and 4:5 derivatives. Cropping must not remove instrument interaction, microphone position, key gestures, commerce overlays, or Café Sativa spatial context. No reference filename or presence in storage grants rights, canon approval, or publishing authority.

## Standard show lifecycle

1. **Pre-show lobby:** countdown, talent/product information, accessibility, sponsor/affiliate disclosures, chat rules, and live-stream health/status when applicable.
2. **Host introduction:** accurate program, performer, venue, and sponsor context.
3. **Main performance:** dynamic multi-camera or multi-scene presentation; no long static-avatar substitute.
4. **Interactive moments:** moderated chat, reactions, questions, polls, requests, or product discovery.
5. **Contextual calls to action:** artist, music, product, event, membership, or replay links placed at relevant moments.
6. **Closing/encore:** next event and approved conversion actions. Live real-world productions transition deliberately to an ended, post-show, or replay-processing state.
7. **Replay:** chapters, captions, persistent moderated context, and time-synchronized artist/product links.
8. **Reconciliation:** publication receipts, public URLs, moderation record, conversion attribution, errors, and replay status.

## Fashion-show spatial flow

Preferred routes must match the canonical venue and remain practical:

- courtyard or beachside terrace → audience aisle → Stage pose/spotlight → exit;
- alternate entrance routes require canonical geometry and owner approval;
- walking paths may not clip through audience, furniture, walls, or commerce overlays;
- Stage placement must preserve the relationship to the courtyard, beachside terrace, bar, and audience.

## Interaction contract

A show is interactive only when at least one real audience capability is live and verified:

- moderated live chat;
- reactions or polls;
- highlighted audience questions;
- clickable, time-coded artist or product cards;
- requests, registrations, tipping, ticketing, or membership actions where approved.

Chat requires authenticated moderator controls, rate limiting, block/remove capability, audit history, and a visible report path. AI hosts may assist moderation but may not silently change policy, publish private data, or override a human moderator.

## Commerce and attribution

Every shoppable or affiliate action must carry:

- canonical product/artist/partner ID;
- exact destination URL;
- show, scene, timestamp, network, and campaign attribution;
- inventory and price check close to publication;
- affiliate/sponsor disclosure where applicable;
- commission or revenue-share rule and settlement owner;
- durable click/conversion receipt when the destination supports it.

The Stage must degrade safely: if a product becomes unavailable or a destination fails validation, the show remains playable while the commerce card is hidden or held. It must not redirect to a guessed substitute.

## Automated production pipeline

The desired unattended path is:

```
approved program brief
→ canonical script and shot plan
→ rights/product/destination binding
→ media generation or approved-media reuse
→ likeness, venue, product, audio, lipsync, text and watermark QA
→ show page + lobby + interaction + commerce metadata
→ owner/content approval during canary
→ scheduled premiere and social promotion through Metricool
→ moderated show
→ provider publication and destination receipts
→ replay, analytics and reconciliation
```

Generation, scheduling, publication, and commerce are separate states. A schedule is not proof of publication; a provider post is not proof of successful playback or conversion.

## Automation and safety rules

- Metricool brand 7605217 is the primary Café Sativa social scheduler.
- The hanging Zapier Facebook Pages OAuth is not a production dependency.
- Exact account, brand, page, network, timezone, media hash, caption, disclosure, schedule, and destination bindings must be verified before dispatch.
- Reuse approved media before paid generation.
- Respect the existing $25 monthly generation cap and atomic reservations.
- No silent paid retry, duplicate post, or ambiguous provider resubmission.
- No third-party watermark.
- Media failing canon, rights, product accuracy, venue geometry, audio, lipsync, visible text, or watermark QA stays held.
- Stage and Gallery generation remain disabled while their current room/object-drift failures are unresolved.
- During the controlled canary, public material uses the existing approval/publish-on-approve gate.
- Eligible pre-approved recurring content may become fully automatic only after seven consecutive days of successful end-to-end receipts with no duplicate, canon, rights, destination, moderation, or stale-content failure.

## Minimum viable Stage release

The first production release should prove one complete experience, not every format at once:

1. one approved program using approved/reusable media;
2. canonical Stage page and replay page;
3. moderated premiere chat;
4. at least one verified artist or product call to action;
5. Metricool promotion on Café Sativa Facebook and Instagram;
6. provider IDs, public URLs, replay receipt, and interaction/moderation evidence;
7. safe failure behavior for unavailable commerce, chat, scheduler, or replay components.

The debut Stage canary is Ahnika performing \"Already Gone\", subject to verified rights, canonical media, audio, lipsync, and exact destinations. The underlying Stage system must remain reusable for other artists, concerts, show formats, and live-streamed real-world events; no Ahnika-specific assumption may be hard-coded into the reusable program, player, chat, commerce, receipt, or replay models.

## Acceptance criteria

The Stage is not considered fully automated until:

- a rolling program queue exists;
- every public asset passed the documented gates;
- the premiere, chat, commerce/artist links, social promotion, publication, replay, and receipts ran without manual data repair;
- stale events and broken destinations are detected and held automatically;
- seven consecutive production days meet the automation and safety rules above.
