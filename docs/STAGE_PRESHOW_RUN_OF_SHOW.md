# Stage pre-show: ambience, MC, and kickoff

The Stage has one authoritative kickoff. The lobby and MC cue occupy the
window before it and may never move it. A prerecorded act remains labeled as
such even when the MC or audience activity is live.

| Moment | Default path | Fail-safe |
| --- | --- | --- |
| Before doors | Muted ambience and scheduled doors-open time; no public event chat | Static artwork for reduced motion, blocked autoplay, or media failure |
| 15 minutes before advertised showtime | Doors open: signed-in audience members can mingle; moderation available; no host Q&A yet | Show sign-in or an honest room-unavailable state |
| Final 30 seconds | MC cue, ideally a captioned prerecorded clip; existing moderator-reviewed host questions can start | Scheduled text welcome with the approved artist and title |
| Kickoff and through Q&A | Existing scheduled performance; same audience chat remains in place | Preserve the time gate; show the player or honest unavailable state |

When scheduling new Stage events, prefer quarter-hour local showtimes
(:00, :15, :30, or :45) with doors one block earlier. Advertise doors and
showtime, without seconds. Keep second-level cues internal to the run of show.

## Per-event prerecorded lane

1. Start with the approved occurrence: event ID, canonical URL, UTC kickoff,
   artist and act, venue, host, approved persona/voice, and pronunciation.
2. Write a short welcome and audience prompt. Separate confirmed facts
   from questions the MC cannot answer. Do not call a prerecorded act live.
3. Reuse an approved template or clip first. If generating a new cue, admit
   only through the existing paid-generation guard and atomic budget, using
   an idempotency key per event, cue, and approved revision. An unknown
   provider outcome must be reconciled before any retry.
4. Review the exact exported bytes and captions: rights/voice permission,
   likeness, venue, pronunciation, audio/lipsync, timing, legibility, and no
   third-party watermark. Record checksum, duration, captions checksum and
   approval receipt. Keep the candidate private until approved.
5. Bind the approved cue to the exact occurrence and require it to fit
   completely before kickoff. Use one cue per occurrence: late entrants
   join at the elapsed position; refresh never starts it over. If the cue
   is missing, unapproved or interrupted, use the text welcome. Never
   delay the performance so the MC can finish.
6. Rehearse the boundary in two independent sessions. Log mode, cue
   identity, timestamp and handoff outcome without storing chat or tokens
   in the receipt. A passing fixture is not production evidence.

## Optional real-time MC lane

Only choose it when the named MC is available, the scoped LiveKit
room/token and audio path have passed rehearsal, captions/transcription
are healthy, and a moderator can mute or return to the backup cue.
Keep MC, attendee, and moderator permissions separate. A model-generated
reply or private concierge conversation does not prove a live MC is on
air. If the live preflight doesn't pass before the intro window, choose
the exact approved recording or the text fallback and keep kickoff fixed.

## Ahnika canary

The lobby still comes from `Stage_Beach_Terrace_Current(1).png` and stays
unchanged. The eight-second golden-hour loop keeps the camera, Stage and
terrace locked. The masked waves advance toward shore and the existing
candles flicker independently, without changing the room lighting.
`scripts/render-stage-surf.py` reproduces the WebM and MP4 from the
checked-in still and synthesizes the matching quiet, sample-exact PCM
surf loop. No paid generation, music, third-party footage, or watermark.

The reusable **Sound** switch tries to play for new guests on arrival.
If the browser requires a gesture, **Enable sound** appears until the
guest interacts. A saved mute choice stays off in either case. Sound
works with reduced motion.
Lobby sound plays on one continuous audio buffer, with no media restarts
or encoder padding at the seam. At kickoff the lobby sound stops; the
same tab carries its mute and volume choices into the performance player.
In Player options, **Still view** changes the backdrop without muting it,
and **Volume** adjusts the lobby sound without turning it on.

A future recorded or live MC segment should read the same guest
preferences at handoff, while keeping its source level separate from the
quieter lobby mix. Stop the lobby bed when spoken program audio starts;
do not reset a guest's volume as the introduction gives way to the act.
The current introduction is text only. A failed media asset does not
prevent lobby use or change kickoff.

The public audience room rejects clear threats, slurs, explicit requests,
private contact details, and common spam or external links before a
message can appear for other guests. This baseline rule filter is paired
with existing reporting and staff removal for context and edge cases.

Source SHA-256: `a734d2cbbfd01c1736931c16bd623f4a67c5826e4d78acedc688044fdb5d13ec`.
The timed text welcome and performance kickoff are unchanged. This change
does not authorize an MC clip or enable a live voice.
