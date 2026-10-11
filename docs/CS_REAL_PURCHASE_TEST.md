# Café Sativa real purchase verification — 2026-10-11

Status: configured candidate; real payment and delivery NOT verified.

## Verified candidate
Regular monthly virtual membership, USD 9.99 per month, recurring until canceled.
Stripe account: acct_1GZMxgIDc7LlvDW9 (owner-selected shared Tru Skool account).
Price: price_1TNFwCIDc7LlvDW9siOcRvdd, active, licensed monthly interval 1.
VIP monthly USD 24.99 also verified; use Regular for the lowest advertised standard monthly test.
Founding and annual prices remain supported for existing subscriptions, not substituted into monthly checkout.
No future scheduled event, published merchandise or paid gallery order exists in the live database at verification.
Historical At The Table Ep. 1 Stripe prices are not evidence of a confirmed upcoming event.

## Customer test sequence
1. Use a separate authenticated customer account without an existing billable subscription. Admin access alone cannot prove purchased access.
2. Open https://www.cafe-sativa.com/membership and choose Regular. Confirm USD 9.99 monthly, renewal, final total and customer email in hosted Stripe Checkout before entering payment.
3. Complete one real payment using the customer's payment method. Do not use test cards in live mode, manually create paid database rows or bypass the website checkout.
4. Verify the paid Stripe session, matching Café Sativa/user/tier metadata, current active subscription and matching customer before accepting delivery.
5. Verify the customer sees Regular active with the correct paid-period end in Account. Verify extended conversation-memory entitlement and confirm admin routes stay inaccessible.
6. Verify account billing opens the same Stripe customer. Verify cancellation and paid-period access handling using that exact subscription. Any refund needs the actual receipt and approved amount; refund alone must not be treated as subscription cancellation.
7. Record session/subscription IDs, actual paid total, entitlement state and customer observations privately. No card data or checkout URLs in reports.

Pass requires real payment AND correct customer entitlement/billing behavior. Existing automated checks do not establish this.
Membership delivers account access, not physical goods. Event tickets still require confirmed date/time, content, capacity and access instructions. Physical merchandise still requires current SKU/variant stock, approved price, fulfillment operator, shipping terms and returns/refund terms. Historical stock emails are insufficient.
