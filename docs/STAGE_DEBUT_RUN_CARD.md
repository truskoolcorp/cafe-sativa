# Ahnika debut — operator run card

Canonical page: https://www.cafe-sativa.com/events/ahnika-already-gone.
Guest-facing schedule: doors November 30 at 11:45 p.m. Central, show
December 1 at midnight Central. The final 30-second MC cue is internal.
Do not move the show to accommodate a late clip, moderator, or social post.

## MC and moderator

### Laviche walk-up and reveal edit

| Cue time | Approved direction |
| --- | --- |
| 0:00–0:06 | Guest-eye view: Laviche walks past the front tables and steps to the mic. Keep the beach terrace visible with its canonical Stage layout. No speech under the walk. |
| 0:06–0:28 | Medium at the mic. Use the script and approved Laviche voice. Deliver the last line with a look and turn toward Ahnika’s performance spot. |
| 0:28–0:30 | Room applause rises as Laviche’s spotlight softens. Dissolve briefly to the approved image of Ahnika seated with her guitar under a warm light. Land on the same still the performance player displays at kickoff. Fade the applause out before the first guitar note. No blackout or hard reset. |

Script: “Good evening, Café Sativa. I’m Laviche. Find your seat, get comfortable, and say hello in the chat. Tonight, we’re keeping it intimate: one voice, one guitar, and a song called ‘Already Gone.’ Please welcome Ahnika Merlot to The Stage.”

Export one 30-second captioned 16:9 cue (H.264/AAC MP4), English WebVTT (include the applause cue), and the approved matching seated reveal still in WebP. Package names: `intro.mp4`, `intro.en.vtt`, `reveal.webp`. Do not add any performance bytes or alter the approved performance cut. Measure the frame-accurate picture and audio trim; check that the spotlight/dissolve and final still match, speech and phonemes sync, applause doesn't mask the introduction or first note, and all captions match the approved lines. Review canonical likeness, wardrobe, venue geometry, rights, visible text and watermark before assigning a public package ID. A package ID is the lowercase SHA-256 of the sorted file-name and SHA-256 pairs in the release manifest; keep the bytes immutable under `public/stage-host-intros/ahnika-already-gone/<package-id>/`.

No production activation until the exact three assets are approved, the public paths are checked, and a protected rehearsal verifies narration, captions, sound preference, late join, and a no-gap handoff without early performance access. Set `STAGE_AHNIKA_APPROVED_HOST_INTRO_RELEASE` to that exact package ID only in the intended environment. With no approval or unusable media, the text welcome remains and the usual kickoff runs on schedule. A staff role grant is not proof of attendance.
Rehearse the production playback path with a non-public fixture before
the show; verify two guest accounts and a staffed moderator for playback,
report and removal, one question, and one trivia answer and reveal.
Save actual premiere receipts separately from rehearsals.

For a private playback rehearsal, use a protected preview with
`STAGE_PRIVATE_REHEARSAL_ENABLED=true` and one explicit UTC
`STAGE_PRIVATE_REHEARSAL_STARTS_AT` value (YYYY-MM-DDTHH:mm:ssZ).
Keep the scope on that preview, not Production. The invite for each
participant must remain valid through the entire cut. On
`/stage/rehearsal`, verify the lobby and the text cue, advance through the
configured kickoff, and verify both guests can play the cut with their
own Sound setting. Confirm signed-out and non-invited users cannot get
media, and invited media requests fail after the planned end. Record
start, playback and cutoff separately from chat, Q&A and moderation.

If Preview cannot reach the approved cut without a production credential,
use the invite-only `/stage/rehearsal` room on the production site. Confirm
the attendee, an existing staff moderator, and a private slot first.
Set only the production `STAGE_PRIVATE_PROD_PLAYBACK_STARTS_AT` to that exact
UTC kickoff. Do not move the public event or export the relay credential.
Grant only the named accounts invitations covering the cut and expiring
within 30 minutes of playback ending. The slot is rejected unless that
latest expiry is at least 15 minutes before the public doors open.
Verify that the signed-out private route denies media, the invited browser
plays during the slot, and the same browser is denied again at the cutoff.
Remove the slot configuration after the run; no replay is published by this test.

## Artist destination, promotion and replay

- Keep “Listen to Already Gone” hidden until the exact official track
  destination is verified and approved.
- Proposed teaser copy, not authorized for publication: “Ahnika Merlot
  brings ‘Already Gone’ to The Stage at Café Sativa. Doors open at
  11:45 p.m. Central on November 30. The acoustic premiere starts at
  midnight Central. Join the audience: https://www.cafe-sativa.com/events/ahnika-already-gone.”
  Bind to exact approved media and disclosure before sending anything to
  Metricool brand 7605217. Verify Facebook and Instagram independently.
- The public performance route serves no player after the show. The
  dedicated route checks the same window for bytes, not just the page.
  Keep replay private until the exact recording is approved and released.
  Test entitled playback and non-entitled denial; an archive link is not
  proof a recording is published.

## Appreciation

After the cut, signed-in guests can post applause to the moderated room
without spending money. Keep the guest-facing **Tip Ahnika** control
hidden until the payee, checkout, crediting and reconciliation are
approved and tested. Use the stable persona ID `ahnika` for internal
attribution, not as a payment destination. Give a host a separate named
option only if separately approved. Any future wallet transfer remains
outside checkout and needs separate authorization. Do not fabricate tips
or provider receipts. Tipping is not a launch gate.
