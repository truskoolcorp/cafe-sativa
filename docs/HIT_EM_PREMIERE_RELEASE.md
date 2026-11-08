# Hit Em public premiere release gate

This is a single owner-approved free public gathering, November 11, 2026 at 00:00 America/Chicago (06:00 UTC), using YouTube video `ZYA0r9JM6eA` and its chat. It is not permission for future recurring publication. No live host or Zoom room is promised.

The exact production event is `00e7d9c6-61b9-4af9-827e-b6d13310b762`, slug `hit-em-release-party`. It was created as a private `draft`. Do not change it to `scheduled` until the listing has been approved. The static page and calendar route fail closed for drafts, mismatched identity/time/title, and nonzero price. Existing ordinary event behavior remains unchanged.

The party page and legacy watch URL require no Café account or ticket. The YouTube player handles its own waiting room and playback transition, so no operator must change an event to `live` just to start the video. The clearly labeled external YouTube link is the live-chat and mobile/failed-embed fallback. Posting to chat needs YouTube sign-in. Public YouTube playback is not exclusive member content.

The existing future-only event query would remove this gathering at midnight. The event helper now merges the exact approved public premiere into listings until it is explicitly ended or canceled, while retaining category, limit, ordering, deduplication, and featured-event choices. It does not revive other past events or change any event status. Mark the gathering ended when it actually finishes; no end time has been invented.

The calendar download is user-initiated and creates no website subscription, external calendar event, email, or SMS. Its UID is stable. It has the approved UTC start and deliberately no invented end time, host, or alarm.

Before release: run the focused regression and application checks; review actual page rendering; verify published event state and exact source on the intended deployment; test signed-out and ordinary-user access, watch redirect, waiting room, mobile fallback and calendar import. Test the production link after deploying and scheduling only with authorization. Keep listing approval and announcement/send approval distinct. Do not bypass preview access protection.


## Protected visual acceptance fixture

`/preview/hit-em-release-party` renders the same party component with only the owner-approved static event facts. It requires both `VERCEL_ENV=preview` and the exact PR branch `feat/hit-em-public-premiere-20261108`; production, development and other branches return not found. It reads or writes no database/account data and does not change the actual draft gate. Its calendar endpoint emits the same calendar bytes with a preview filename and private/no-store headers. A visible notice distinguishes this test fixture from a live listing; both routes are noindex. Deployment authentication remains enabled. Use only the explicitly approved temporary private access link, and revoke it after QA. This tests the design, player and calendar; it does not substitute for signed-out production acceptance after an authorized release.

Confirmed event results now appear above concept features on `/events`, without changing filters, admission, or publication status.
