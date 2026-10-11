# Café Sativa current status — 2026-10-11

This dated status supersedes older status claims, not approved canonical material.

## Confirmed baseline
- Fifteen venue masters are approved; six introductory website entries are published.
- Only the Bar pilot clip is approved. Stage, Gallery, Kitchen, Cigar Lounge and Community clips failed review. Four untouched room jobs remain planned on the current policy. An unbound duplicate Community draft is blocked because the current master already has a rejected take.
- Generation is paused, with a $25 monthly ceiling and $6 reserved. No new paid rendering is authorized by this reconciliation.
- Chef V permissions were confirmed by the owner; all Café Sativa use remains on owner hold. CHEF SAYS is a separate project.
- Dedicated LiveKit worker source and conversation-memory endpoints are implemented. A server-only bridge secret and agent name are provisioned; live mode stays disabled. LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET remain absent. No dedicated Café Sativa worker is deployed. The feature-gated RTC browser client is implemented; it stays hidden while disabled and requires live audio acceptance. Existing browser voice mode remains separate from LiveKit.
- Three social posts are scheduled for October 12, 14 and 16 at 7pm Chicago. Scheduled status is not proof of delivery. Website Metricool OAuth reported invalid_grant; reconnect and actual delivery verification remain open.
- The selected Stripe live account is the shared Tru Skool account. Café Sativa has six verified subscription prices. No actual paid purchase/refund/fulfillment verification has completed.
- Historical event rows are in the past and are not valid upcoming programming. Product catalog is empty.
- Video masters default to 16:9. Platform exports currently fit and pad the full frame; they do not perform subject-tracking reframing.

## Security correction batch
- Diagnostic is admin-only and makes no paid model request.
- Membership events require exact verified Café Sativa prices, matching tier, user and customer. Existing founding/annual subscriptions can use billing management.
- New membership and ticket checkouts include explicit site ownership metadata. Ticket webhook events require Café Sativa ownership, paid payment mode, USD and a positive paid amount.
- Ticket checkout rejects foreign origins, malformed event IDs and past dates, and treats database failures as failures. Ticket inventory now uses atomic event-locked reservations and fulfillment. Holds expire after 40 minutes; Checkout expires after 35 minutes. Late settled payments without capacity are recorded for admin reconciliation rather than granting an extra seat.

- Customer ticket controls close past and unavailable events. A checkout success URL displays pending confirmation until verified ticket access exists.
- The approved historical Bar master is supported by an exact ID/version/path/hash exception in the authenticated canonical bridge; all downloaded bytes still require the approved SHA-256.

## Remaining acceptance work
Real paid ticket checkout/receipt/refund verification; corrected room clips; canonical-linked character episodes; Metricool reconnect and delivery receipts; dedicated LiveKit deployment and audio testing; authenticated customer/admin access tests; paid checkout/refund/fulfillment; monitoring and recovery. Never interpret code completion as successful end-to-end production verification.

## Ticket reservation validation
Rollback-only database checks passed for reuse, held and free capacity, missing receipt rejection, payment replay, refunded repurchase, expired holds and late-settlement reconciliation. API mock tests passed for quotes, immutable checkout expiry, Stripe idempotency and session binding. These checks do not prove a real paid transaction or email delivery. Admin payment exceptions are visible at `/admin/tickets`; no refund is issued automatically.

## Canonical voice verification
Live Studio records reconfirm Keith, Laviche, Ahnika and Ginger use their canonical ElevenLabs voice IDs. Approved portraits and voices do not constitute an approved episode script, composite scene, or completed render. Chef V remains excluded.

## October 11 continuation
- Railway ownership verified as truskoolcorp@truskool.net. Existing `glyph-ecosystem` / `anya-worker` has LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, DEEPGRAM_API_KEY, ELEVEN_API_KEY, OPENAI_API_KEY and RUNWAYML_API_SECRET. OAuth exposes names only. No secret was copied, rotated or replaced.
- Creating a dedicated `cafe-sativa-voice-worker` was rejected: "You have used all your available resources." Read-back confirms no worker was created. Source services were not modified. Website credentials remain unprovisioned.
- Worker Docker packaging and credential-free preflight checks are prepared. Worker registration, audio, usage and recovery remain unverified.
- `/admin/episodes` contains three new script drafts: Laviche's Bar welcome, Ahnika's Stage introduction, and Keith/Laviche's At the Table introduction. Exact live room, portrait, rights, production-ready and voice checks gate script approval. Script revisions invalidate old approvals. No scripts were owner-approved or rendered automatically; composite keyframes and clip reviews remain required. Chef V is excluded.
- Live database: no confirmed future scheduled events, products or orders. Archived June event timing was explicitly provisional. No event, product, price, stock or fulfillment fact was invented to trigger a charge.
- Gallery confirmation now requires a stored paid receipt; refunded orders do not display a download or fulfillment offer. Missing receipt shows pending confirmation. Customer copy no longer claims unverified immediate delivery, worldwide shipping or a 2026 physical opening. This does not prove digital access revocation at an external source or email delivery.
- Browser voice lifecycle, canonical episode gates, worker preflight and existing entitlement tests pass. Production build passes. Live provider audio and real paid purchase/refund/fulfillment remain outstanding.

## October 11 payment recovery continuation
- Production monthly checkout validates the exact allowlisted live Stripe price, USD amount and monthly interval against advertised Regular 9.99 / VIP 24.99 prices. Unconfirmed weekly events and reserved physical opening claims were removed from membership offers.
- Authenticated membership refresh retrieves the linked Stripe subscription, verifies exact Café Sativa price, user and customer, synchronizes current status/period and reports scheduled cancellation. Updates require the same stored subscription ID to avoid overwriting a concurrent replacement. Manual admin access is not changed.
- Membership recovery, checkout, portal, entitlement and LiveKit authorization/memory tests pass; production build passes. No real charge, cancellation or refund has been performed, and live audio is not verified.
- Metricool fresh read confirms posts 390856410 / 390803327 / 390803425 remain PENDING for Oct 12/14/16 at 7pm Chicago. Their dates are in the future; no published receipt is claimed.
- Attempt to create post-publication checks was rejected by the automation service: current plan allows only 5 scheduled tasks (5 active). No task was created, and unrelated existing tasks were not paused.
- Railway fresh inventory still has no dedicated Café Sativa worker. The earlier resource-capacity rejection and secure credential transfer remain unresolved.
