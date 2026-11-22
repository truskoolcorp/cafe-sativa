# Ahnika debut — operator run card

Canonical page: https://www.cafe-sativa.com/events/ahnika-already-gone.
Guest-facing schedule: doors November 30 at 11:45 p.m. Central, show
December 1 at midnight Central. The final 30-second MC cue is internal.
Do not move the show to accommodate a late clip, moderator, or social post.

## MC and moderator

Laviche draft: “Welcome to The Stage at Café Sativa. Settle in, and drop
a note in the chat if you’re ready. Tonight, we’re keeping it close and
acoustic. Please welcome Ahnika Merlot with ‘Already Gone.’”

Keep the timed text welcome until an exact captioned, approved voice
asset fits the cue. A staff role grant is not proof of attendance.
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
