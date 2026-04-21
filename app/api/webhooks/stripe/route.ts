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

        // Route by kind. Ticket purchases are mode='payment' and carry
        // metadata.kind='ticket'. Subscription purchases are
        // mode='subscription' with metadata.tier. Older sessions without
        // metadata.kind are assumed to be subscription (legacy behavior).
        const kind = session.metadata?.kind

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
