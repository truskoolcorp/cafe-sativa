# Café Sativa production acceptance and recovery

Updated 2026-10-11. Code completion never substitutes for customer/provider acceptance.

| Area | Acceptance evidence | Recovery |
| --- | --- | --- |
| Membership payment | Real paid checkout and correct authenticated customer tier/period | Account → Refresh payment and access; retrieve current exact owned Stripe subscription. If no link exists yet, inspect webhook delivery rather than create a paid row. |
| Cancellation | Same customer's portal subscription, cancel-at-period-end flag and retained paid-period access | Refresh from Stripe; never infer cancellation from a refund. |
| Refund | Actual charge/receipt, approved refund amount, Stripe success and reconciled entitlement/order | Retry failed webhook; distinguish full/partial refunds and cancel subscription separately when intended. No unrequested refund. |
| Ticket inventory | Confirmed future event, real paid reservation and one issued ticket | Check /admin/tickets for late-payment exceptions. Reconcile payment before retry; do not oversell or automatically refund. |
| LiveKit | Dedicated registered agent; each exact host voice; duplex audio, interruptions, memory isolation and reconnect | Keep live flag disabled when unconfigured. Fix worker/credential problem; never route public visitors to Anya executive tools or Habla's lesson agent. |
| Room/episode media | Exact current master/portrait/script/voice and visual QA | Failed take remains rejected. Check provider unknown submissions before retry. Owner approval required for changed canon. |
| Social delivery | Actual provider post URL/receipt after due time, correct account/media/copy | Reconcile planner/provider before any retry. Missing scheduled entry does not mean published. Website OAuth reconnect remains necessary. |
| Monitoring | Created task or deployed scheduler, successful run and actionable alert evidence | Automation creation currently blocked by five-active-task limit. No new task exists. Keep approved Oct 12/14/16 posts unchanged. |

## Merchandise evidence recovered
Owner's October 1 received bulk inventory: 45 units, excluding the earlier Concrete Rose sample sent to Bea.
- H.O.E. hoodies 10; tees 15.
- Faithfully Faded Hooded Baseball Jersey Dress 10: S1 / M3 / L4 / XL2.
- Concrete Rose Varsity Jacket + Skirt Set 10: S2 / M3 / L3 / XL2.
These are dated receipt quantities, not a synchronized October 11 sellable-stock ledger. Current approved retail price, shipper/dispatch timing, returns terms and storefront product mapping remain unverified. Do not insert merchandise into the artist Stripe Connect gallery as a workaround. Do not use manufacturer costs as retail prices.

## Explicit outstanding dependencies
Railway previously rejected the dedicated worker due to resource capacity; fresh service inventory has no Café Sativa worker. OAuth exposes credential names, not usable secret values. Website LiveKit credentials and Runway developer secret must be provisioned securely. No paid render or audio acceptance has occurred. All three episode scripts have recorded owner approvals matching current hashes (20:32 UTC October 11). Approved scripts and portraits do not establish approved composite scenes or completed renders. Chef V remains on owner hold.

A real purchase requires the customer's authenticated session and payment method. Do not ask for card credentials in chat, submit fabricated test cards in live mode or claim an admin's existing free access proves paid fulfillment.
