# Website programming provenance

Recovered 9 October 2026 from prior owner instructions. Website introductions
remain pending owner approval; they describe formats, not confirmed bookings.

- June 1, 2026: Ahnika Merlot open mic, three minutes of verse/spoken word/song, all tiers. Laviche Comedy Night Open Floor, stand-up/improv and performer sign-up.
- June 1 and June 15, 2026: At the Table, Keith Ingram with Laviche, 90 minutes, long table, venue story and pre-opening community. June dates are historical. Earlier access prices must be revalidated before selling a new session.
- June 1, 2026: Laviche Cuban-versus-Dominican blind tasting/community vote, cigar-and-whiskey pairing, VIP Craft Roundtable. No current event dates inferred.
- June 1, 2026: Sourdough Fundamentals with Andromeda Zouganelis was a June planning item, not a renewed booking.
- April 17, 2026: virtual-first website, featured/visiting chefs one or two times monthly. This cadence is intent, not confirmation of contracted appearances.
- September 7, 2026: Café Sativa After Dark umbrella; MUKBANG After Dark flagship. The Table Talk, First Bite, ASMR Bang, Rate My Plate, challenges and audience voting. Voting/submissions/reward systems are not implemented by the introductory copy.
- June 17, 2025: THE Verse Alkemist is official Media Curator. No invented Gallery exhibition or specific Bar show was recovered.
- June 11, 2025: four vectors: art, smoke, music/community/environment, fusion cuisines; not a coffee concept.
- October 2026: physical venue planned 2027, precise opening date unconfirmed. Approved bar pilot may introduce the future venue vision.

Implementation uses existing content_items, not a second content database. Stable
site keys prevent duplicate initial drafts. Approval freezes final copy; the daily
cron publishes due approved text. Character media and external social delivery
require their own canonical and scheduler receipts. The initial introductions are
text only; no paid generation occurs.

## Per-item social destination approval

The configured delivery route remains Metricool brand 5373515 / account 4174093,
Facebook page 146219355471397 and Threads @truskoolcorp. This configuration is not
standing approval to publish future items. The website review form displays the
versioned destination descriptor, and social approval must submit that exact
descriptor with the individual clip, caption and release time. Copy/time edits,
refreshes and reopening a card clear both approval checkboxes.

New queue records preserve the approved destination in
`cs_social_deliveries.receipt.approvedDestination`. New dispatch requires the
current descriptor in addition to the existing caption, time, approval and QA
checks. Scheduling and later receipt checks retain that snapshot. Legacy
scheduled receipts remain historical evidence and continue to reconcile; no
snapshot is backfilled. A legacy queued record without the snapshot is blocked
before media preparation or a new provider submission. It requires investigation
and a new explicit approval, never automatic migration into consent.

A lost response is not evidence that a save, queue insertion or publication did
not happen. The form closes stale edits, refreshes status and requires renewed
review. If that read fails, mutations remain disabled until status can be read.
Inspect existing social receipts before any further delivery action. Website
publication counts and worker results describe their whole batches, not necessarily
the selected item. No schema, route expansion, recurring approval or dispatch
configuration change is part of this guard.
