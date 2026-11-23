# November 24 private dress-rehearsal media

This wiring is rehearsal-only. It does not select or publish assets for the December 1 premiere.
Do not activate the timed slot until the exact package has passed creative and audio review,
two audience accounts and an authorized moderator are confirmed, and the deployed invite-only
route has been checked without changing the public schedule.

The private `cafe-sativa-content` bucket contains four separately approved, immutable objects
under `stage-rehearsal/2026-11-24/`. Name each object by the SHA-256 of its bytes and the
extension below. Verify the uploaded bytes against each digest and size; never overwrite
content at an existing digest path. Do not use the combined audition or old cursor cut.

| Manifest key | Object suffix | Exact approved content |
| --- | --- | --- |
| intro | .mp4 | Standalone 30-second Laviche cue. No performance footage or leading guitar that repeats at kickoff. |
| captions | .en.vtt | English timed captions checked against that actual mix, including meaningful applause. |
| reveal | .webp | Approved seated Ahnika reveal matched to the performance opening. |
| performance | .mp4 | Clean performance-only cut, with no cursor or repeated introduction, aligned to the 99.7-second performance slot. |

Only after verification, `STAGE_PRIVATE_DRESS_MEDIA` receives a JSON object with exactly these
four keys, each holding `{"sha256":"<64 lowercase hex characters>","bytes":<integer>}`.
No secret URL is passed to a browser. The old rehearsal media selector can't be used for this
dress slot. A missing or invalid manifest shows a hold, not an unverified fallback.

For the rehearsal receipt: verify denied direct media off-cue and without an invitation,
the captioned intro at 7:59:30 a.m. Central, and the reveal and one performance start at 8 a.m.
Collect both viewer results (including mute, volume, first interaction, and late join).
Confirm text-only interaction during the performance, a reviewed reply and moderation action,
and no public schedule or content changes. The synthetic tests are not a hosted receipt.
