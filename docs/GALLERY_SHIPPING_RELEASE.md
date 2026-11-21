# Gallery shipping rollout

Do not enable physical checkout for an item without a verified fulfillment
owner, rate and destination. This first path supports one item per order, in
USD, with a verified flat rate covering **all Stripe-accepted US addresses**.
If a supplier excludes any of those addresses, do not enable this path for that
item. International, mixed-cart, multi-quantity and address-specific rates
require a separate checkout flow. Digital items do not use these rules.

After confirming the vendor quote and how shipping proceeds reach the party
that buys the label, create or verify a fixed Stripe Shipping Rate on this
site's account. On the existing destination-charge path, the destination
receives the funds less the application fee; verify this matches who fulfills
the order or leave it disabled. Do not assume free shipping from a provider
name alone; use an explicit approved included-shipping rule for that item.

Set the server-side `CAFE_GALLERY_SHIPPING_RULES` config as a JSON object keyed
by exact product UUID. Each entry needs `rateId`, integer `amountCents`,
`country: "US"`, `mode: "customer_paid"` (positive amount) or `"included"`
(zero amount), `expiresAt` (UTC ISO timestamp) and `approvalRef` (internal
quote/approval reference, no private customer data). No rates are configured by
this change. A missing or expired rule cannot start payment. An active Stripe
rate must match the configured price and currency at checkout time.

Before enabling a product, verify the Stripe checkout breakdown, destination,
delivery expectations, applicable tax handling, and order receipt using test
data. Do not infer provider-funded shipping from a storefront promotion: review
the actual checkout and supplier cost. Existing externally fulfilled storefronts
and existing Stripe sessions are not changed by this configuration.
