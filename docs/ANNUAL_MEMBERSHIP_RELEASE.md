# Annual membership rollout

Annual billing is another cadence for the same membership tiers, not a new
entitlement or a lifetime offer. Explorer remains free.

| Tier | Monthly (unchanged) | Annual (USD) | Stripe product |
| --- | ---: | ---: | --- |
| Regular | $9.99 | $99.90 | `prod_ULxrCgCmYnTWOF` |
| VIP | $24.99 | $249.90 | `prod_ULxsmvOgLeiyYy` |

1. In the existing Café Sativa Stripe account, verify each product and look
   for an exact active USD licensed recurring yearly price before creating
   one. Use the existing product, a stable lookup key, and idempotent creation
   if needed. The legacy $99/$249 yearly prices are not these offers.
2. Bind the two exact price IDs with server-only `STRIPE_PRICE_REGULAR_ANNUAL`
   and `STRIPE_PRICE_VIP_ANNUAL`. Do not replace monthly or legacy price IDs.
3. Verify the selling entity, launch markets, membership tax classification,
   and registration requirements. Confirm the annual Stripe prices are
   explicitly tax-exclusive. Annual Checkout calculates applicable tax using
   the customer's billing address; Stripe cannot collect in a jurisdiction
   without applicable registration configuration. Do not invent registrations
   or assume the account's head-office address establishes all obligations.
   Verify a taxable and non-taxable checkout or sandbox tax fixture before
   activation. For markets that require tax-inclusive consumer price display,
   complete that display and checkout work before offering the plan there.
4. Verify both checkout totals and annual renewal language, sign-in return,
   and cancellation portal behavior. Exercise activation, renewal and
   cancellation with test evidence before exposing annual checkout. Do not
   place a real test charge as part of the rollout.
5. Enable `NEXT_PUBLIC_CAFE_ANNUAL_MEMBERSHIPS=true` only after verification;
   redeploy because public configuration is embedded in the UI build.
   Rollback: disable the flag and redeploy. Keep both annual price IDs
   configured so Stripe webhooks, refresh and billing remain functional
   for anyone who already subscribed.

Do not change existing subscription prices or move monthly members onto
annual plans. Complimentary access does not use Stripe checkout.
