# Ordinary Gallery release — 2026-11-24

Owner approved autonomous ordinary artwork launch only after acceptance gates. Keep paid checkout off by default; never test a live charge. Web3/NFT sales, minting and wallet activation excluded. Do not modify Stage, membership, tickets or December 1 premiere.

## First listing (private preparation; not published)
- Title: Where the Brass Meets the Tide
- Slug: where-the-brass-meets-the-tide
- Credit: Café Sativa Studio (house artwork, not an independent seller)
- Description: AI-generated digital artwork from Café Sativa Studio. Original delivery format PNG, 1672 × 941 pixels. No NFT, scarcity, exclusive rights, or print-quality claim.
- Approved price: USD 12.00 (1200 minor units), owner approval 11:39 UTC Nov 24.
- Master SHA-256: 33483b370c172774d73b2a7445322e9973422e90e3cefdbcf0fa6ed01ec06f93. Keep exact master in private approved bucket; verify digest before staging; public copy must be resized separately. No public master or library links.
- Existing checkout requires approved artist Connect destination; DO NOT fabricate an artist or use unrelated account. House settlement needs explicit recorded house sale model, provider mapping and refund tests; independent 90/10 tested separately in dedicated sandbox. No DB listing mutation yet.

## New-sales gate and rollback
- GALLERY_SALES_ENABLED defaults off; only new checkout checks it. Requires holds, private downloads, digital worker, and correct Stripe key mode. Paid/refunded webhooks and existing fulfillment/access stay available independent of switch. Disable switch and redeploy Gallery's approved release to stop new sessions; existing Stripe sessions can still settle and must be honored. Verify read-only UI after rollback; no shared key removal.
- No production flag changes in this patch. Do not enable until exact green CI, actual dedicated Stripe sandbox and DB/storage proof (two buyers, competing hold, signed paid/replay, split and fees, actual download/refund/denial/restock), verified house settlement, approved private master/public derivative, owner and artist reporting, reviewed additive migrations, desktop/mobile/keyboard/reduced motion evidence, shared file diff review and non-disruptive release window.
- Current Gallery canon still only; old moving tour excluded. Zaria live voice/public portrait unverified. No NFT listing surface or checkout at ordinary launch.
