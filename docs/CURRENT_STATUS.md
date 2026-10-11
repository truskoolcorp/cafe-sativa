# Café Sativa current status — 2026-10-11

This dated status supersedes older status claims, not approved canonical material.

## Confirmed baseline
- Fifteen venue masters are approved; six introductory website entries are published.
- Only the Bar pilot clip is approved. Stage, Gallery, Kitchen, Cigar Lounge and Community clips failed review. Four untouched room jobs remain planned on the current policy. An unbound duplicate Community draft is blocked because the current master already has a rejected take.
- Generation is paused, with a $25 monthly ceiling and $6 reserved. No new paid rendering is authorized by this reconciliation.
- Chef V permissions were confirmed by the owner; all Café Sativa use remains on owner hold. CHEF SAYS is a separate project.
- The dedicated LiveKit worker and conversation-memory endpoints are implemented. Live production audio remains unverified; required LiveKit production configuration is absent.
- Three social posts are scheduled for October 12, 14 and 16 at 7pm Chicago. Scheduled status is not proof of delivery. Website Metricool OAuth reported invalid_grant; reconnect and actual delivery verification remain open.
- The selected Stripe live account is the shared Tru Skool account. Café Sativa has six verified subscription prices. No actual paid purchase/refund/fulfillment verification has completed.
- Historical event rows are in the past and are not valid upcoming programming. Product catalog is empty.
- Video masters default to 16:9. Platform exports currently fit and pad the full frame; they do not perform subject-tracking reframing.

## Security correction batch
- Diagnostic is admin-only and makes no paid model request.
- Membership events require exact verified Café Sativa prices, matching tier, user and customer. Existing founding/annual subscriptions can use billing management.
- New membership and ticket checkouts include explicit site ownership metadata. Ticket webhook events require Café Sativa ownership, paid payment mode, USD and a positive paid amount.
- Ticket checkout rejects foreign origins, malformed event IDs and past dates, and treats database failures as failures. Capacity-limited sales are temporarily closed until atomic reservation/fulfillment is implemented; this is a safeguard, not completed inventory management.

- Customer ticket controls close past and unavailable events. A checkout success URL displays pending confirmation until verified ticket access exists.
- The approved historical Bar master is supported by an exact ID/version/path/hash exception in the authenticated canonical bridge; all downloaded bytes still require the approved SHA-256.

## Remaining acceptance work
Atomic ticket reservations and paid fulfillment; corrected room clips; canonical-linked character episodes; Metricool reconnect and delivery receipts; dedicated LiveKit deployment and audio testing; authenticated customer/admin access tests; paid checkout/refund/fulfillment; monitoring and recovery. Never interpret code completion as successful end-to-end production verification.
