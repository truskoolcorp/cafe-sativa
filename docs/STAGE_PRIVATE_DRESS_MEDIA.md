# November 24 private dress-rehearsal media

This wiring is rehearsal-only. It does not select or publish assets for the December 1 premiere.
Do not activate the timed slot until the exact package has passed creative and audio review,
two audience accounts and an authorized moderator are confirmed, and the deployed invite-only
route has been checked without changing the public schedule.

Use the dedicated private `cafe-sativa-dress-rehearsal` bucket, with a 40 MB file limit
and allowed types `video/mp4`, `image/webp`, and `text/vtt`. Do not make the bucket
public, add direct viewer Storage policies, or relax the existing content bucket.
The dedicated bucket holds four separately approved, immutable objects
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
Confirm picture and sound continuity in the hosted player. A still used while the next
video loads or a second play click at the reveal is not a seamless handoff.
Confirm text-only interaction during the performance, a reviewed reply and moderation action,
and no public schedule or content changes. The synthetic tests are not a hosted receipt.

The handoff player buffers 1.25 seconds on the viewer side; it does not fetch any
performance bytes before the scheduled cue or extend the server's media cutoff.

Private reporting additionally requires `STAGE_PRIVATE_DRESS_REPORTS_ENABLED=true`
on the rehearsal deployment and the private report migration. Laviche can only
hide a reported, exact repeated link from a non-staff speaker in that room. This
is a reversible room display action, not deletion or a ban. Normal, sensitive,
and uncertain reports stay queued for independently authorized rehearsal staff.
Do not claim someone is on the staff queue without a verified grant and operator.
Check a visible report acknowledgement, suppression for two distinct invited
viewers, and a staff resolution separately. Keep the report flag off until ready.

The identical rehearsal-only migration was registered on the hosted database as
`20261123131346_stage_dress_report_lane`. Use that recorded version; do not apply
the earlier draft filename separately. Table and RPC access remains server-only;
verified closed-window calls did not create or resolve any report.
