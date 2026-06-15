import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'

type MembershipTier = 'regular' | 'vip'
type MembershipStatus = 'active' | 'canceled' | 'past_due' | 'incomplete'

function mapStripeStatus(s: string): MembershipStatus {
  switch (s) {
    case 'active': case 'trialing': return 'active'
    case 'past_due': case 'unpaid': return 'past_due'
    case 'canceled': case 'incomplete_expired': return 'canceled'
    default: return 'incomplete'
  }
}

function extractPeriodEnd(sub: Stripe.Subscription): string | null {
  const fi = sub.items?.data?.[0]
  if (!fi?.current_period_end) return null
  return new Date(fi.current_period_end * 1000).toISOString()
}

export async function POST(req: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeSecretKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe webhook not configured.' }, { status: 500 })
  }
  const stripe = new Stripe(stripeSecretKey)
  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 })
  const rawBody = await req.text()
  let event: Stripe.Event
  try { event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret) }
  catch { return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 }) }

  const admin = createAdminClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const kind = session.metadata?.kind

        if (kind === 'ticket') {
          const userId = session.metadata?.user_id
          const eventId = session.metadata?.event_id
          if (!userId || !eventId) {
            console.warn('[stripe-webhook] ticket session missing metadata', { sessionId: session.id })
            break
          }
          const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent : session.payment_intent?.id ?? null
          const { data: existing } = await admin.from('tickets').select('id,state')
            .eq('event_id', eventId).eq('user_id', userId).maybeSingle()
          if (existing && existing.state !== 'refunded') {
            console.log(`[stripe-webhook] ticket already exists user=${userId} event=${eventId}, ack`)
            break
          }
          const { error: insertError } = await admin.from('tickets').insert({
            event_id: eventId, user_id: userId, source: 'purchased',
            state: 'valid', stripe_payment_intent_id: paymentIntentId,
            amount_paid_cents: session.amount_total ?? 0,
          })
          if (insertError) {
            console.error('[stripe-webhook] Failed to insert ticket', insertError)
            return NextResponse.json({ error: 'Ticket write failed.' }, { status: 500 })
          }
          // Send confirmation email with Zoom join link
          try {
            const [{ data: ev }, { data: usr }] = await Promise.all([
              admin.from('events').select('title,subtitle,starts_at,zoom_join_url,slug,presenter_name').eq('id', eventId).maybeSingle(),
              admin.from('auth.users' as any).select('email').eq('id', userId).maybeSingle(),
            ])
            const toEmail: string = (usr as any)?.email || session.customer_details?.email || session.customer_email || ''
            if (ev && toEmail && ev.zoom_join_url) {
              const { sendTicketConfirmation } = await import('@/lib/email/send-ticket-confirmation')
              await sendTicketConfirmation({
                to: toEmail,
                eventTitle: ev.title,
                eventSubtitle: ev.subtitle ?? null,
                startsAt: ev.starts_at,
                zoomJoinUrl: ev.zoom_join_url,
                eventSlug: ev.slug,
                amountPaidCents: session.amount_total ?? 0,
                presenterName: ev.presenter_name ?? null,
              })
              console.log(`[stripe-webhook] Ticket confirmation email sent to ${toEmail}`)
            } else {
              console.warn('[stripe-webhook] Skipped ticket email - missing event, email, or zoom_join_url', { hasEvent: !!ev, toEmail, hasZoom: !!(ev as any)?.zoom_join_url })
            }
          } catch (emailErr) {
            console.error('[stripe-webhook] ticket confirmation email failed (non-fatal)', emailErr)
          }
          console.log(`[stripe-webhook] Ticket issued: user=${userId} event=${eventId} pi=${paymentIntentId}`)
          break
        }

        if (kind === 'gallery_order') {
          const userId = session.metadata?.user_id
          const productId = session.metadata?.product_id
          const artistId = session.metadata?.artist_id
          const quantity = parseInt(session.metadata?.quantity || '1', 10)
          if (!userId || !productId || !artistId) {
            console.warn('[stripe-webhook] gallery session missing metadata', { sessionId: session.id })
            break
          }
          const { data: existing } = await admin.from('orders').select('id').eq('stripe_checkout_session_id', session.id).maybeSingle()
          if (existing) { console.log(`[stripe-webhook] gallery order already exists session=${session.id}, ack`); break }
          const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
          const shipping = session.collected_information?.shipping_details ?? null
          const addr = shipping?.address ?? null
          const { data: product } = await admin.from('products').select('id,title,price_cents,kind,digital_delivery_url,stock_count').eq('id', productId).maybeSingle()
          if (!product) { console.error('[stripe-webhook] unknown product', productId); break }
          const { data: artist } = await admin.from('artists').select('stripe_account_id').eq('id', artistId).maybeSingle()
          const lineTotal = product.price_cents * quantity
          const applicationFee = Math.floor(lineTotal * 0.1)
          const fulfillmentState = product.kind === 'physical' ? 'pending' : 'delivered'
          const { data: order, error: orderError } = await admin.from('orders').insert({
            user_id: userId, buyer_email: session.customer_details?.email || session.customer_email || '',
            stripe_checkout_session_id: session.id, stripe_payment_intent_id: paymentIntentId,
            subtotal_cents: lineTotal, shipping_cents: session.shipping_cost?.amount_total ?? 0,
            tax_cents: session.total_details?.amount_tax ?? 0, total_cents: session.amount_total ?? lineTotal,
            currency: session.currency || 'usd', shipping_name: shipping?.name ?? null,
            shipping_line1: addr?.line1 ?? null, shipping_line2: addr?.line2 ?? null,
            shipping_city: addr?.city ?? null, shipping_state: addr?.state ?? null,
            shipping_postal_code: addr?.postal_code ?? null, shipping_country: addr?.country ?? null,
            fulfillment_state: fulfillmentState, paid_at: new Date().toISOString(),
            delivered_at: fulfillmentState === 'delivered' ? new Date().toISOString() : null,
          }).select('id').single()
          if (orderError || !order) return NextResponse.json({ error: 'Order write failed.' }, { status: 500 })
          await admin.from('order_items').insert({
            order_id: order.id, product_id: productId, artist_id: artistId,
            title_snapshot: product.title, price_cents: product.price_cents, quantity,
            line_total_cents: lineTotal, application_fee_cents: applicationFee,
            transfer_destination: artist?.stripe_account_id ?? null,
          })
          if (product.stock_count !== null && product.stock_count !== undefined) {
            await admin.from('products').update({ stock_count: Math.max(0, product.stock_count - quantity) }).eq('id', productId)
          }
          try {
            const { sendOrderConfirmation } = await import('@/lib/email/send-order-confirmation')
            await sendOrderConfirmation({
              to: session.customer_details?.email || session.customer_email || '',
              orderId: order.id, productTitle: product.title, productKind: product.kind,
              priceCents: product.price_cents, quantity, totalCents: session.amount_total ?? lineTotal,
              digitalDeliveryUrl: product.digital_delivery_url ?? null, fulfillmentState,
            })
          } catch (emailErr) { console.error('[stripe-webhook] order confirmation email failed', emailErr) }
          console.log(`[stripe-webhook] gallery order issued: order=${order.id} product=${productId}`)
          break
        }

        // Subscription (default/legacy)
        const userId = session.metadata?.user_id
        const tier = session.metadata?.tier as MembershipTier | undefined
        if (!userId || !tier) {
          console.warn('[stripe-webhook] checkout.session.completed missing metadata', { sessionId: session.id })
          break
        }
        const stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
        const stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null
        let currentPeriodEnd: string | null = null
        if (stripeSubscriptionId) {
          try { const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId); currentPeriodEnd = extractPeriodEnd(sub) } catch {}
        }
        await admin.from('memberships').upsert({
          user_id: userId, tier, status: 'active',
          stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId,
          current_period_end: currentPeriodEnd,
        }, { onConflict: 'user_id' })
        console.log(`[stripe-webhook] Granted ${tier} to user ${userId}`)
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.user_id
        const tier = sub.metadata?.tier as MembershipTier | undefined
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : mapStripeStatus(sub.status)
        if (!userId || !tier) {
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
          const { data: existing } = await admin.from('memberships').select('user_id,tier').eq('stripe_customer_id', customerId).maybeSingle()
          if (!existing) { console.warn('[stripe-webhook] subscription event for unknown customer'); break }
          await admin.from('memberships').update({ status, current_period_end: extractPeriodEnd(sub) }).eq('user_id', existing.user_id)
          break
        }
        const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
        await admin.from('memberships').upsert({
          user_id: userId, tier, status, stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: sub.id, current_period_end: extractPeriodEnd(sub),
        }, { onConflict: 'user_id' })
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null
        if (!paymentIntentId) break
        const { data: ticket } = await admin.from('tickets').select('id,state').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle()
        if (!ticket || ticket.state === 'refunded') break
        await admin.from('tickets').update({ state: 'refunded' }).eq('id', ticket.id)
        console.log(`[stripe-webhook] Ticket ${ticket.id} refunded`)
        break
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        const payoutsEnabled = account.payouts_enabled ?? false
        const chargesEnabled = account.charges_enabled ?? false
        const detailsSubmitted = account.details_submitted ?? false
        let onboardingState: 'pending' | 'active' | 'rejected' = 'pending'
        if (payoutsEnabled && chargesEnabled) onboardingState = 'active'
        else if (detailsSubmitted && !payoutsEnabled) onboardingState = 'rejected'
        await admin.from('artists').update({
          payouts_enabled: payoutsEnabled, charges_enabled: chargesEnabled,
          onboarding_state: onboardingState, is_approved: onboardingState === 'active',
        }).eq('stripe_account_id', account.id)
        break
      }

      default: break
    }
    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('[stripe-webhook] Handler error:', err)
    return NextResponse.json({ error: err?.message || 'Webhook handler failed.' }, { status: 500 })
  }
}
