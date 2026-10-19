# Café Sativa Virtual — approved functional blueprint

Approved source: owner's early Base44 screenshots (Home, Stage, Gallery, Kitchen, Shop, Community, Dashboard, Cigar Lounge). Preserve **current Next.js visual identity**, Supabase production safety, canonical assets, approved content and the existing billing/membership functions. Do **not** migrate Base44 demo people, conversations, events, products, metrics, balances or privileges as genuine records.

## Delivery sequence and acceptance
1. **Member dashboard**: Keep existing `/account` authentication, roles and Stripe billing. Add real `My Tickets` from authenticated RLS-filtered tickets, current membership, real activity, points ledger + earned/redeemed totals, approved perk catalog, next-tier progress. Never calculate balances from client-side mock fixtures. First phase adds discoverability only while these APIs are designed.
2. **VIP replay vault**: Approved recordings with event/host/category/date, explicit `published` status, media provenance and rights; server-side entitlement checks for VIP or a specific permitted purchase. No replay URL included in public HTML/JSON when access denied. Only approved canonical media.
3. **Recipes**: Approved chef, ingredients, method, allergens, related event; published public previews and tier-gated downloadable cards when approved. No generated chef identity or invented sessions.
4. **Curated recommendations**: editorially approved podcast episodes, external links, accessibility information and topic tags. Validate destination, review rights/ownership, avoid automatic unverified cross-posting or affiliate links.
5. **Stage calendars and history**: event list/calendar views backed by actual event data, correct venue timezone and member access; archived event recording relationships.
6. **Loyalty**: append-only awarded/redeemed points ledger, idempotent purchase/referral keys, anti-self-referral, controlled bonus tiers and audited reward redemption. No credit awarded for historic mockups.

## Safety gates
- Authenticated account routes, server-derived membership and admin privileges; never rely only on client tier claims.
- Production schema changes through independently tested additive migrations and RLS policies, not direct ad-hoc writes.
- Feature-flag unreleased experiences; disclose empty/pending libraries rather than fabricated content.
- Before any release, test unauthorized/expired memberships, direct media URL bypasses, duplicate points, webhook refund reversal, access revocation and free/regular/VIP behavior.
- Keep publishing and charged transactions disabled during tests; deploy only with reviewed migrations and rollback plan.
- Existing site features/links remain intact. Screenshots are the functional reference, not a mandate to revert the visual design.

## First incremental code change
`MemberExperience` restores feature discovery on the current `/account` dashboard using only existing routes. It does **not** claim that unbuilt vault, library, or rewards functionality already exists.
