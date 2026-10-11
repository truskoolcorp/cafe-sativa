import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { cafeSubscriptionTier } from '@/lib/membership-prices'

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
  // The existing webhook uses Stripe's 2020 event schema, which places
  // this value on the subscription. Current SDK retrievals use items.
  const end = fi?.current_period_end ?? (sub as unknown as {current_period_end?: number}).current_period_end
  if (typeof end !== 'number' || !Number.isFinite(end) || end <= 0) return null
  const date = new Date(end * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
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
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session
        // A completed checkout can still have a delayed, unpaid payment.
        if (session.payment_status === 'unpaid') break
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
          if (session.payment_status !== 'paid' || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw Error('Invalid gallery payment')
          const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
          if(!paymentIntentId)throw Error('Payment intent required')
          const [lines,intent]=await Promise.all([
            stripe.checkout.sessions.listLineItems(session.id,{limit:2}),
            stripe.paymentIntents.retrieve(paymentIntentId),
          ])
          if(lines.has_more || lines.data.length!==1 || lines.data[0].quantity!==quantity)throw Error('Checkout line mismatch')
          const line=lines.data[0],lineTotal=line.amount_subtotal
          const applicationFee=intent.application_fee_amount
          if(!Number.isInteger(lineTotal)||lineTotal<=0||lineTotal%quantity!==0||applicationFee===null)throw Error('Invalid paid line')
          const shipping = session.collected_information?.shipping_details ?? null
          const addr = shipping?.address ?? null
          const { data: product,error:productError } = await admin.from('products').select('id,title,kind,digital_delivery_url').eq('id', productId).maybeSingle()
          if(productError || !product)throw Error('Paid product unavailable')
          const fulfillmentState='pending'
          const {data:recorded,error:recordError}=await admin.rpc('cs_record_gallery_payment',{
            product_uuid:productId,artist_uuid:artistId,quantity,
            receipt:{session_id:session.id,payment_status:session.payment_status,user_id:userId,
              payment_intent_id:paymentIntentId,email:session.customer_details?.email || session.customer_email || '',
              subtotal_cents:lineTotal,total_cents:session.amount_total,currency:session.currency || 'usd',
              application_fee_cents:applicationFee,title:line.description,
              shipping_cents:session.shipping_cost?.amount_total || 0,tax_cents:session.total_details?.amount_tax || 0,
              shipping_name:shipping?.name,shipping_line1:addr?.line1,shipping_line2:addr?.line2,
              shipping_city:addr?.city,shipping_state:addr?.state,shipping_postal_code:addr?.postal_code,shipping_country:addr?.country},
          })
          if(recordError || !recorded?.id)throw Error('Atomic paid order write failed')
          if(!recorded.created)break
          const order={id:recorded.id}
          try {
            const { sendOrderConfirmation } = await import('@/lib/email/send-order-confirmation')
            await sendOrderConfirmation({
              to: session.customer_details?.email || session.customer_email || '',
              orderId: order.id, productTitle: product.title, productKind: product.kind,
              priceCents: lineTotal / quantity, quantity, totalCents: session.amount_total ?? lineTotal,
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
        if (!['regular','vip'].includes(tier) || !stripeSubscriptionId) throw new Error('Invalid membership checkout metadata')
        // Fetch current state: webhook delivery order does not establish entitlement.
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
        const verifiedTier=cafeSubscriptionTier(subscription)
        const subscriptionCustomer=typeof subscription.customer==='string'?subscription.customer:subscription.customer.id
        if(!verifiedTier || verifiedTier!==tier || subscription.metadata?.user_id!==userId || subscriptionCustomer!==stripeCustomerId || (session.metadata?.site && session.metadata.site!=='cafe-sativa')) break
        const currentPeriodEnd = extractPeriodEnd(subscription)
        const { error: membershipError } = await admin.from('memberships').upsert({
          user_id: userId, tier, status: mapStripeStatus(subscription.status),
          stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId,
          current_period_end: currentPeriodEnd,
        }, { onConflict: 'user_id' })
        if (membershipError) throw membershipError
        console.log('[stripe-webhook] Membership synchronized')
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const receivedSub = event.data.object as Stripe.Subscription
        const sub = event.type === 'customer.subscription.deleted' ? receivedSub : await stripe.subscriptions.retrieve(receivedSub.id)
        const userId = sub.metadata?.user_id
        const tier = cafeSubscriptionTier(sub)
        // This account is shared with other projects. Foreign prices never confer access.
        if(!tier)break
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : mapStripeStatus(sub.status)
        if (!userId) {
          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
          const { data: existing,error:existingError } = await admin.from('memberships').select('user_id,tier,stripe_subscription_id').eq('stripe_customer_id', customerId).maybeSingle()
          if(existingError)throw existingError
          if(existing?.stripe_subscription_id!==sub.id)break
          if (!existing) { console.warn('[stripe-webhook] subscription event for unknown customer'); break }
          const { error: updateError } = await admin.from('memberships').update({ status, current_period_end: extractPeriodEnd(sub) }).eq('user_id', existing.user_id)
          if (updateError) throw updateError
          break
        }
        const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
        if (!['regular','vip'].includes(tier)) throw new Error('Invalid subscription tier')
        const { error: subscriptionError } = await admin.from('memberships').upsert({
          user_id: userId, tier, status, stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: sub.id, current_period_end: extractPeriodEnd(sub),
        }, { onConflict: 'user_id' })
        if (subscriptionError) throw subscriptionError
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null
        if (!paymentIntentId || !charge.refunded) break
        const {error:orderRefundError}=await admin.from('orders').update({fulfillment_state:'refunded',updated_at:new Date().toISOString()}).eq('stripe_payment_intent_id',paymentIntentId)
        if(orderRefundError)throw orderRefundError
        const { data: ticket } = await admin.from('tickets').select('id,state').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle()
        if (!ticket || ticket.state === 'refunded') break
        const {error:ticketRefundError}=await admin.from('tickets').update({ state: 'refunded' }).eq('id', ticket.id)
        if(ticketRefundError)throw ticketRefundError
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
    console.error('[stripe-webhook] Handler failed; event remains retryable')
    return NextResponse.json({ error: 'Webhook handler failed; retry required.' }, { status: 500 })
  }
}

