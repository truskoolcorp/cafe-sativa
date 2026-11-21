# Stage pre-show: ambience, MC, and kickoff

The Stage has one authoritative kickoff. The lobby and MC cue occupy the
window before it and may never move it. A prerecorded act remains labeled as
such even when the MC or audience activity is live.

| Moment | Default path | Fail-safe |
| --- | --- | --- |
| Arrival | Muted, pauseable ambience from the approved room visual | Static artwork for reduced motion, blocked autoplay, or media failure |
| Final 30 seconds | Event-specific MC cue, ideally a captioned prerecorded clip | Scheduled text welcome with the approved artist and title |
| Kickoff | Existing scheduled performance | Preserve the time gate; show the player or honest unavailable state |

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
unchanged. The eight-second golden-hour cinemagraph keeps the Stage and
terrace locked, with only the waves moving in the masked ocean openings.
`scripts/render-stage-surf.py` reproduces the WebM, MP4 and a quiet,
procedural surf-sound loop from the checked-in approved still. There is
no paid generation, music, third-party footage, or watermark. The video
is silent; sound is separately opt-in, available with reduced motion,
and stopped at kickoff. The still remains usable if either media file fails.

Source SHA-256: `a734d2cbbfd01c1736931c16bd623f4a67c5826e4d78acedc688044fdb5d13ec`.
The timed text welcome and performance kickoff are unchanged. This change
does not authorize an MC clip or enable a live voice.
