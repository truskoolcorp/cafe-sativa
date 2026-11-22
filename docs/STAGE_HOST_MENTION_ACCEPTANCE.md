# Stage guest mentions and host Q&A acceptance

Do not enable the new inbox or automatic replies on production before a protected
signed-in rehearsal. Apply the additive inbox migration to the isolated database
first. Use two authorized guest accounts and one authorized, available room
moderator. Use synthetic questions and no payment, account, or personal details.

## Scope and switches

- `STAGE_HOST_INBOX_ENABLED=true`: turns on private in-room questions in an
  eligible Stage room. No change to playback, public chat, audience access or the
  moderator grants. The private inbox is not on the shared Realtime channel.
- `STAGE_AUTO_TEXT_REPLIES_ENABLED=true`: lets the inbox answer exact, verified
  routine questions as text. Missing persona context, unavailable facts, mixed
  requests, and sensitive questions stay pending for a moderator. Turning just
  this switch off keeps the moderator queue working.
- Stage questions and replies have no voice playback. No voice service request
  should appear while testing them, including during the performance.
- @mentions are room messages, not DMs or push notifications. The composer
  suggests visible speakers, and readers see recognized mentions highlighted.

## Required rehearsal receipts

1. Both guests can open the same protected room and see differently colored
   names, each with a **You** marker only on their own messages. Send an
   @mention from the desktop, see it on mobile, then reply from mobile.
2. Ask each host a supported, verified question. Confirm the correct host name,
   correct schedule for the rehearsal (not the public premiere), one saved reply,
   and no voice requests. Reopen the panel and confirm the reply persists.
3. Send a synthetic uncertain or sensitive question. Only the asking guest and
   room moderator should be able to see it. The guest must see a submission
   receipt, the moderator must be able to reply once, and the original guest
   must see the reply. No duplicate, no shared chat copy, and no host voice.
4. Repeat during the approved cut: verify lobby audio and saved sound preferences,
   start at the cue without refreshing, and sound/volume behavior on both
   browsers. Check the protected cut in two sessions, late join, ending and archive
   access separately. The rehearsal does not certify any exact premiere media
   transition that was not part of the tested cut.
5. With an authorized moderator, verify report and removal, one poll/trivia
   round, and appropriate reply/queue behavior on network interruption.

Capture pass/fail per browser and receipt, without publishing tester names,
private questions, invitation links or credentials. Do not label mocked route,
local database or media metadata checks as hosted participation evidence.
