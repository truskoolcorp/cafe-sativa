import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/webhooks/stripe
 *
 * Stripe → us. Handles subscription lifecycle events and keeps
 * public.memberships in sync for every user who has ever subscribed.
 *
 * Events handled:
 *   - checkout.session.completed  → first-time purchase, write row
 *   - customer.subscription.updated  → tier change, renewal, past-due
 *   - customer.subscription.deleted  → cancellation (end of period)
 *
 * Design notes:
 *   1. All writes go through the Supabase admin client (service-role
 *      key) to bypass RLS. Clients NEVER write memberships directly.
 *   2. Stripe is source of truth for subscription state; Postgres is
 *      a read replica. If this webhook drops an event, the next event
 *      re-syncs from subscription data. We don't try to reconstruct
 *      state from checkout.session alone.
 *   3. Always `upsert` on user_id. If the user resubscribes after
 *      canceling, we update the existing row rather than insert-conflict.
 *   4. On `deleted`, we set status to 'canceled' but keep the row —
 *      this preserves stripe_customer_id for future resubscribe flows
 *      and lets the UI show "your VIP access runs through Apr 30."
 */

// Narrow Stripe's plan-tier values (in subscription metadata) to our enum
type MembershipTier = 'regular' | 'vip'
type MembershipStatus = 'active' | 'canceled' | 'past_due' | 'incomplete'

function mapStripeStatus(stripeStatus: string): MembershipStatus {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled'
    case 'incomplete':
    default:
      return 'incomplete'
  }
}

/**
 * Extract the current billing-period end from a Stripe Subscription.
 * In Stripe SDK v18+, `current_period_end` is a property of each
 * subscription item (not the root subscription), since subs can now
 * have items on different billing cycles. For single-item subscriptions
 * we read from items.data[0].
 */
function extractPeriodEnd(sub: Stripe.Subscription): string | null {
  const firstItem = sub.items?.data?.[0]
  if (!firstItem?.current_period_end) return null
  return new Date(firstItem.current_period_end * 1000).toISOString()
}

export async function POST(req: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!stripeSecretKey || !webhookSecret) {
    console.error('[stripe-webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
    return NextResponse.json(
      { error: 'Stripe webhook is not configured.' },
      { status: 500 }
    )
  }

  const stripe = new Stripe(stripeSecretKey)

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature.' }, { status: 400 })
  }

  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err: any) {
    console.error('[stripe-webhook] Signature verification failed:', err?.message)
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  const admin = createAdminClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        // Route by kind. Subscription purchases are mode='subscription'
        // with metadata.tier. Payment sessions carry metadata.kind —
        // 'ticket' for event tickets, 'gallery_order' for gallery
        // purchases. Older sessions without metadata.kind are assumed
        // to be subscription (legacy behavior).
        const kind = session.metadata?.kind

        if (kind === 'gallery_order') {
          const userId = session.metadata?.user_id
          const productId = session.metadata?.product_id
          const artistId = session.metadata?.artist_id
          const quantity = parseInt(session.metadata?.quantity || '1', 10)

          if (!userId || !productId || !artistId) {
            console.warn('[stripe-webhook] gallery session missing metadata', {
              sessionId: session.id,
              metadata: session.metadata,
            })
            break
          }

          // Idempotency guard: webhook replay must not double-insert.
          // stripe_checkout_session_id is unique on orders.
          const { data: existing } = await admin
            .from('orders')
            .select('id')
            .eq('stripe_checkout_session_id', session.id)
            .maybeSingle()

          if (existing) {
            console.log(
              `[stripe-webhook] gallery order already exists for session=${session.id}, ack`
            )
            break
          }

          // Grab the full PaymentIntent so we can record the PI id and
          // pull the application fee amount that actually landed (vs
          // what we requested).
          const paymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id ?? null

          // Shipping details (if collected). In Stripe SDK v18 these
          // moved under collected_information.shipping_details.
          const shipping =
            session.collected_information?.shipping_details ?? null
          const addr = shipping?.address ?? null

          // Re-fetch the product to snapshot its title + price at the
          // moment of purchase (product row may drift after this).
          const { data: product } = await admin
            .from('products')
            .select(
              'id, title, price_cents, kind, digital_delivery_url, stock_count'
            )
            .eq('id', productId)
            .maybeSingle()

          if (!product) {
            console.error(
              '[stripe-webhook] gallery order references unknown product',
              { productId, sessionId: session.id }
            )
            break
          }

          // Look up the artist's Connect account for the snapshot
          const { data: artist } = await admin
            .from('artists')
            .select('stripe_account_id')
            .eq('id', artistId)
            .maybeSingle()

          const lineTotal = product.price_cents * quantity
          // Platform fee: we requested 10% on the PaymentIntent at
          // checkout creation time; compute the same value here for
          // the snapshot. If you want the exact confirmed number,
          // retrieve the PaymentIntent by paymentIntentId — for v1
          // the derived value is fine since we're the ones who set it.
          const applicationFee = Math.floor(lineTotal * 0.1)

          // Digital/nft goods deliver immediately; physical waits for
          // shipment.
          const fulfillmentState =
            product.kind === 'physical' ? 'pending' : 'delivered'

          // Insert order
          const { data: order, error: orderError } = await admin
            .from('orders')
            .insert({
              user_id: userId,
              buyer_email:
                session.customer_details?.email ||
                session.customer_email ||
                '',
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: paymentIntentId,
              subtotal_cents: lineTotal,
              shipping_cents: session.shipping_cost?.amount_total ?? 0,
              tax_cents: session.total_details?.amount_tax ?? 0,
              total_cents: session.amount_total ?? lineTotal,
              currency: session.currency || 'usd',
              shipping_name: shipping?.name ?? null,
              shipping_line1: addr?.line1 ?? null,
              shipping_line2: addr?.line2 ?? null,
              shipping_city: addr?.city ?? null,
              shipping_state: addr?.state ?? null,
              shipping_postal_code: addr?.postal_code ?? null,
              shipping_country: addr?.country ?? null,
              fulfillment_state: fulfillmentState,
              paid_at: new Date().toISOString(),
              delivered_at:
                fulfillmentState === 'delivered'
                  ? new Date().toISOString()
                  : null,
            })
            .select('id')
            .single()

          if (orderError || !order) {
            console.error(
              '[stripe-webhook] failed to insert gallery order',
              orderError
            )
            return NextResponse.json(
              { error: 'Order write failed.' },
              { status: 500 }
            )
          }

          // Insert order_items (v1 = one item per order)
          const { error: itemError } = await admin.from('order_items').insert({
            order_id: order.id,
            product_id: productId,
            artist_id: artistId,
            title_snapshot: product.title,
            price_cents: product.price_cents,
            quantity,
            line_total_cents: lineTotal,
            application_fee_cents: applicationFee,
            transfer_destination: artist?.stripe_account_id ?? null,
          })

          if (itemError) {
            console.error(
              '[stripe-webhook] failed to insert order_items',
              itemError
            )
            // Don't 500 — the order row is already in, better to ack
            // and let us fix it manually than to let Stripe retry and
            // double-insert the order.
          }

          // Decrement stock if it was tracked
          if (
            product.stock_count !== null &&
            product.stock_count !== undefined
          ) {
            await admin
              .from('products')
              .update({
                stock_count: Math.max(0, product.stock_count - quantity),
              })
              .eq('id', productId)
          }

          // Fire-and-forget: order confirmation email via Resend.
          // Done inline so we have the order + product snapshot in
          // scope. If Resend isn't configured or fails, we log and
          // move on — the order is still valid.
          try {
            const { sendOrderConfirmation } = await import(
              '@/lib/email/send-order-confirmation'
            )
            await sendOrderConfirmation({
              to:
                session.customer_details?.email ||
                session.customer_email ||
                '',
              orderId: order.id,
              productTitle: product.title,
              productKind: product.kind,
              priceCents: product.price_cents,
              quantity,
              totalCents: session.amount_total ?? lineTotal,
              digitalDeliveryUrl: product.digital_delivery_url ?? null,
              fulfillmentState,
            })
          } catch (emailErr) {
            console.error(
              '[stripe-webhook] order confirmation email failed',
              emailErr
            )
          }

          console.log(
            `[stripe-webhook] gallery order issued: order=${order.id} product=${productId} artist=${artistId}`
          )
          break
        }

        if (kind === 'ticket') {
          const userId = session.metadata?.user_id
          const eventId = session.metadata?.event_id

          if (!userId || !eventId) {
            console.warn(
              '[stripe-webhook] ticket session missing metadata',
              { sessionId: session.id, metadata: session.metadata }
            )
            break
          }

          const paymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id ?? null

          // Guard against webhook replay — Stripe retries webhooks up to
          // several days on 5xx, so a duplicate event must not create a
          // second ticket row. The `unique (event_id, user_id)` constraint
          // on tickets enforces this at the DB level; we check here so
          // we can return 2xx cleanly instead of logging a constraint error.
          const { data: existing } = await admin
            .from('tickets')
            .select('id, state')
            .eq('event_id', eventId)
            .eq('user_id', userId)
            .maybeSingle()

          if (existing && existing.state !== 'refunded') {
            console.log(
              `[stripe-webhook] ticket already exists for user=${userId} event=${eventId}, ack`
            )
            break
          }

          const { error: insertError } = await admin.from('tickets').insert({
            event_id: eventId,
            user_id: userId,
            source: 'purchased',
            state: 'valid',
            stripe_payment_intent_id: paymentIntentId,
            amount_paid_cents: session.amount_total ?? 0,
          })

          if (insertError) {
            console.error('[stripe-webhook] Failed to insert ticket', insertError)
            return NextResponse.json(
              { error: 'Ticket write failed.' },
              { status: 500 }
            )
          }

          console.log(
            `[stripe-webhook] Ticket issued: user=${userId} event=${eventId} pi=${paymentIntentId}`
          )
          break
        }

        // === Subscription path (default / legacy) ===
        // Metadata was attached when we created the session
        const userId = session.metadata?.user_id
        const tier = session.metadata?.tier as MembershipTier | undefined

        if (!userId || !tier) {
          console.warn(
            '[stripe-webhook] checkout.session.completed missing metadata',
            { sessionId: session.id, metadata: session.metadata }
          )
          // Not fatal — webhooks from the customer portal or legacy
          // sessions may not carry our metadata. The subscription.updated
          // event that fires next will carry the same metadata via
          // subscription_data, so we just ack and move on.
          break
        }

        const stripeCustomerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id ?? null
        const stripeSubscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null

        // Fetch the subscription to grab current_period_end via the helper.
        let currentPeriodEnd: string | null = null
        if (stripeSubscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
            currentPeriodEnd = extractPeriodEnd(sub)
          } catch (err) {
            console.warn('[stripe-webhook] Could not retrieve subscription for period end', err)
          }
        }

        const { error: upsertError } = await admin
          .from('memberships')
          .upsert(
            {
              user_id: userId,
              tier,
              status: 'active',
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: stripeSubscriptionId,
              current_period_end: currentPeriodEnd,
            },
            { onConflict: 'user_id' }
          )

        if (upsertError) {
          console.error('[stripe-webhook] Failed to upsert membership', upsertError)
          return NextResponse.json(
            { error: 'Database write failed.' },
            { status: 500 }
          )
        }

        console.log(
          `[stripe-webhook] Granted ${tier} to user ${userId} (sub ${stripeSubscriptionId})`
        )
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription

        const userId = sub.metadata?.user_id
        const tier = sub.metadata?.tier as MembershipTier | undefined

        if (!userId || !tier) {
          // Find the user via stripe_customer_id if metadata is missing.
          // This handles subscriptions created outside of our checkout flow
          // (e.g. directly in the Stripe Dashboard) where we didn't set metadata.
          const customerId =
            typeof sub.customer === 'string' ? sub.customer : sub.customer.id

          const { data: existing } = await admin
            .from('memberships')
            .select('user_id, tier')
            .eq('stripe_customer_id', customerId)
            .maybeSingle()

          if (!existing) {
            console.warn(
              '[stripe-webhook] subscription event for unknown customer',
              { event: event.type, customerId }
            )
            break
          }

          // Fall back to the existing tier — we can't infer it from price_id
          // without a mapping table, and updating status alone is enough.
          const resolvedStatus =
            event.type === 'customer.subscription.deleted'
              ? 'canceled'
              : mapStripeStatus(sub.status)

          await admin
            .from('memberships')
            .update({
              status: resolvedStatus,
              current_period_end: extractPeriodEnd(sub),
            })
            .eq('user_id', existing.user_id)

          console.log(
            `[stripe-webhook] Updated existing membership for user ${existing.user_id} → ${resolvedStatus}`
          )
          break
        }

        // Metadata-present path: full upsert
        const status =
          event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : mapStripeStatus(sub.status)

        const stripeCustomerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id

        const { error: upsertError } = await admin
          .from('memberships')
          .upsert(
            {
              user_id: userId,
              tier,
              status,
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: sub.id,
              current_period_end: extractPeriodEnd(sub),
            },
            { onConflict: 'user_id' }
          )

        if (upsertError) {
          console.error('[stripe-webhook] Failed to upsert on subscription event', upsertError)
          return NextResponse.json(
            { error: 'Database write failed.' },
            { status: 500 }
          )
        }

        console.log(
          `[stripe-webhook] ${event.type} synced: user=${userId} tier=${tier} status=${status}`
        )
        break
      }

      case 'charge.refunded': {
        // Handle ticket refunds — mark the ticket row as refunded so
        // the user loses access. Doesn't apply to subscription refunds,
        // which flow through customer.subscription.updated instead.
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null

        if (!paymentIntentId) {
          // No payment_intent → probably a non-ticket charge. Ack.
          break
        }

        const { data: ticket } = await admin
          .from('tickets')
          .select('id, state')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .maybeSingle()

        if (!ticket) {
          // Not a ticket we issued. Ack (could be a subscription charge).
          break
        }

        if (ticket.state === 'refunded') {
          console.log(`[stripe-webhook] ticket ${ticket.id} already marked refunded, ack`)
          break
        }

        await admin
          .from('tickets')
          .update({ state: 'refunded' })
          .eq('id', ticket.id)

        console.log(`[stripe-webhook] Ticket ${ticket.id} refunded (pi=${paymentIntentId})`)
        break
      }

      case 'account.updated': {
        // Connect account capability change. Mirror to artists row.
        // This fires when an artist finishes onboarding, adds a bank
        // account, gets capabilities enabled/disabled, or when Stripe
        // requests more info (triggering capability loss).
        const account = event.data.object as Stripe.Account

        const payoutsEnabled = account.payouts_enabled ?? false
        const chargesEnabled = account.charges_enabled ?? false
        const detailsSubmitted = account.details_submitted ?? false

        let onboardingState: 'pending' | 'active' | 'rejected' = 'pending'
        if (payoutsEnabled && chargesEnabled) {
          onboardingState = 'active'
        } else if (detailsSubmitted && !payoutsEnabled) {
          onboardingState = 'rejected'
        }

        const isApproved = onboardingState === 'active'

        const { data: updated, error: updateError } = await admin
          .from('artists')
          .update({
            payouts_enabled: payoutsEnabled,
            charges_enabled: chargesEnabled,
            onboarding_state: onboardingState,
            is_approved: isApproved,
          })
          .eq('stripe_account_id', account.id)
          .select('id')

        if (updateError) {
          console.error(
            '[stripe-webhook] account.updated: failed to sync artist',
            updateError
          )
          break
        }

        if (updated && updated.length > 0) {
          console.log(
            `[stripe-webhook] account.updated: artist=${updated[0].id} state=${onboardingState} payouts=${payoutsEnabled} charges=${chargesEnabled}`
          )
        }
        break
      }

      default:
        // Ack unrelated events so Stripe doesn't retry them forever
        break
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('[stripe-webhook] Handler error:', err)
    return NextResponse.json(
      { error: err?.message || 'Webhook handler failed.' },
      { status: 500 }
    )
  }
}
