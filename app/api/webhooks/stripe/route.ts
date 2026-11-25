import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import {recordGalleryRefunds} from '@/lib/gallery/reconcile-refunds'
import {galleryEnvironment,galleryRequestUrl} from '@/lib/gallery/environment'
import {galleryHouseConfig, gallerySellerKind, verifiedGalleryHouseAccount} from '@/lib/gallery/house-checkout'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncCafeMembership } from '@/lib/sync-membership'

type MembershipTier = 'regular' | 'vip'
export async function POST(req: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const galleryMode = galleryEnvironment(galleryRequestUrl(req))
  const dedicated = new URL(req.url).pathname === '/api/gallery/webhook'
  // Dedicated sandbox ingress never accepts production credentials; shared ingress
  // must not consume Gallery test events or operate on the isolated database.
  if ((dedicated && galleryMode !== 'isolated-test') || (!dedicated && galleryMode === 'isolated-test')) {
    return NextResponse.json({ error: 'Gallery test webhook requires dedicated isolated ingress.' }, { status: 503 })
  }
  const webhookSecret = galleryMode === 'isolated-test'
    ? process.env.GALLERY_TEST_STRIPE_WEBHOOK_SECRET : process.env.STRIPE_WEBHOOK_SECRET
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

  if (galleryMode === 'isolated-test') {
    if (event.livemode !== false) return NextResponse.json({ error: 'Test event required.' }, { status: 400 })
    const isGalleryCheckout = (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') &&
      (event.data.object as Stripe.Checkout.Session).metadata?.kind === 'gallery_order' && (event.data.object as Stripe.Checkout.Session).metadata?.site === 'cafe-sativa'
    if (stripeSecretKey.startsWith('rkcs_test_') && event.type !== 'charge.refunded' &&
        (!isGalleryCheckout || (event.data.object as Stripe.Checkout.Session).metadata?.gallery_sale_kind !== 'house')) {
      return NextResponse.json({ received: true })
    }
    if (!isGalleryCheckout && event.type !== 'charge.refunded' && event.type !== 'account.updated') {
      return NextResponse.json({ received: true })
    }
  }

  // Avoid even initializing an admin client for a Gallery-only event on a misconfigured preview.
  if (galleryMode === 'blocked' && ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') &&
    (event.data.object as Stripe.Checkout.Session).metadata?.kind === 'gallery_order' || event.type === 'account.updated')) {
    return NextResponse.json({ error: 'Gallery webhook is not isolated.' }, { status: 503 })
  }

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
          // This Stripe account serves multiple projects; ticket metadata alone is not ownership.
          if(session.metadata?.site !== 'cafe-sativa' || session.mode !== 'payment' || session.payment_status !== 'paid' || session.currency !== 'usd' || !Number.isInteger(session.amount_total) || (session.amount_total ?? 0) <= 0) break
          const userId = session.metadata?.user_id
          const eventId = session.metadata?.event_id
          if (!userId || !eventId) {
            console.warn('[stripe-webhook] ticket session missing metadata', { sessionId: session.id })
            break
          }
          const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent : session.payment_intent?.id ?? null
          const reservationId=session.metadata?.reservation_id
          if(!reservationId || !paymentIntentId)throw Error('Ticket reservation metadata missing')
          const {data:recorded,error:recordError}=await admin.rpc('cs_record_ticket_payment',{
            reservation_uuid:reservationId,
            receipt:{site:session.metadata?.site,payment_status:session.payment_status,currency:session.currency,
              user_id:userId,event_id:eventId,session_id:session.id,payment_intent_id:paymentIntentId,amount_cents:session.amount_total},
          })
          if(recordError || !recorded)throw Error('Atomic ticket fulfillment failed')
          if(recorded.state==='payment_attention')console.error('[stripe-webhook] Ticket payment needs reconciliation',{reservationId,sessionId:session.id})
          if(!recorded.created)break
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
          if(!Number.isSafeInteger(lineTotal)||lineTotal<=0||lineTotal%quantity!==0)throw Error('Invalid paid line')
          const shipping = session.collected_information?.shipping_details ?? null
          const addr = shipping?.address ?? null
          const { data: product,error:productError } = await admin.from('products').select('id,title,kind,digital_delivery_url').eq('id', productId).maybeSingle()
          if(productError || !product)throw Error('Paid product unavailable')
          const fulfillmentState='pending'
          const holdId=session.metadata?.inventory_hold_id
          const approvedAssetId=session.metadata?.approved_asset_id
          const sellerKind=gallerySellerKind(productId,artistId,product.kind)
          const house=galleryHouseConfig()
          const sessionSaleKind=session.metadata?.gallery_sale_kind
          const intentSaleKind=intent.metadata?.gallery_sale_kind
          const housePayment=sessionSaleKind==='house' || intentSaleKind==='house' || sellerKind!=='consigned'
          let applicationFee=intent.application_fee_amount
          if(housePayment){
            // A signed Stripe event still must match server-controlled identities, pending reservation,
            // the actual platform key's account, and the provider's transfer-free settlement.
            if(sellerKind!=='house'||!house||sessionSaleKind!=='house'||intentSaleKind!=='house'||
              session.metadata?.gallery_platform_account_id!==house.accountId||intent.metadata?.gallery_platform_account_id!==house.accountId||
              (event.account&&event.account!==house.accountId)||
              !holdId||!approvedAssetId||session.metadata?.site!=='cafe-sativa'||session.mode!=='payment'||
              intent.metadata.kind!=='gallery_order'||intent.metadata.product_id!==productId||
              intent.metadata.artist_id!==artistId||intent.metadata.user_id!==userId||
              intent.id!==paymentIntentId||intent.status!=='succeeded'||intent.livemode!==(galleryMode==='production')||
              event.livemode!==intent.livemode||session.livemode!==intent.livemode||
              intent.currency!==session.currency||line.currency!==intent.currency||
              !Number.isSafeInteger(session.amount_total)||intent.amount_received!==session.amount_total||
              intent.amount!==session.amount_total||intent.transfer_data||intent.on_behalf_of||
              (applicationFee!==null&&applicationFee!==0)||
              !await verifiedGalleryHouseAccount(stripe,house.accountId,false))throw Error('Invalid house Gallery settlement')
            applicationFee=0
          }else if(applicationFee===null||sessionSaleKind||intentSaleKind)throw Error('Invalid artist Gallery settlement')
          const privateMarker=session.metadata?.gallery_private_schema
          const privateIntentMarker=intent.metadata?.gallery_private_schema
          const privateConsignment=!!privateMarker || !!privateIntentMarker
          let privateDestination: string | undefined
          if(privateConsignment){
            const destination=intent.transfer_data?.destination
            privateDestination=typeof destination==='string'?destination:destination?.id
            if(housePayment||product.kind!=='digital'||privateMarker!=='consigned-v1'||privateIntentMarker!=='consigned-v1'||
              !holdId||!approvedAssetId||!/^[0-9a-f-]{36}$/i.test(approvedAssetId)||
              !privateDestination||!/^acct_[A-Za-z0-9]+$/.test(privateDestination)||
              session.metadata?.gallery_transfer_destination!==privateDestination||intent.metadata?.gallery_transfer_destination!==privateDestination||
              intent.metadata?.approved_asset_id!==approvedAssetId||intent.metadata?.inventory_hold_id!==holdId||
              session.mode!=='payment'||intent.metadata?.kind!=='gallery_order'||intent.metadata?.product_id!==productId||
              intent.metadata?.artist_id!==artistId||intent.metadata?.user_id!==userId||intent.id!==paymentIntentId||
              intent.status!=='succeeded'||intent.livemode!==(galleryMode==='production')||
              event.livemode!==intent.livemode||session.livemode!==intent.livemode||
              intent.currency!==session.currency||line.currency!==intent.currency||
              !Number.isSafeInteger(session.amount_total)||intent.amount_received!==session.amount_total||
              intent.amount!==session.amount_total||intent.on_behalf_of||
              applicationFee!==Math.floor(lineTotal/10))throw Error('Invalid private consigned Gallery settlement')
          }
          if (galleryMode === 'isolated-test' && (!holdId || (product.kind === 'digital' && !session.metadata?.approved_asset_id))) throw Error('Isolated test purchase requires a reservation and approved digital edition')
          if(holdId && (session.metadata?.site!=='cafe-sativa' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(holdId)))throw Error('Invalid gallery reservation')
          const {data:recorded,error:recordError}=await admin.rpc(housePayment?'cs_record_house_gallery_payment':privateConsignment?'cs_record_consigned_private_gallery_payment':holdId?'cs_record_reserved_gallery_payment':'cs_record_gallery_payment',{
            ...(holdId?{p_hold:holdId}:{}),
            ...((housePayment||privateConsignment)?{p_asset:approvedAssetId}:{}),
            product_uuid:productId,artist_uuid:artistId,quantity,
            receipt:{session_id:session.id,payment_status:session.payment_status,user_id:userId,
              payment_intent_id:paymentIntentId,email:session.customer_details?.email || session.customer_email || '',
              subtotal_cents:lineTotal,total_cents:session.amount_total,currency:session.currency || 'usd',
              application_fee_cents:applicationFee,title:line.description,
              ...(privateConsignment?{transfer_destination:privateDestination}:{}),
              shipping_cents:session.shipping_cost?.amount_total || 0,tax_cents:session.total_details?.amount_tax || 0,
              shipping_name:shipping?.name,shipping_line1:addr?.line1,shipping_line2:addr?.line2,
              shipping_city:addr?.city,shipping_state:addr?.state,shipping_postal_code:addr?.postal_code,shipping_country:addr?.country},
          })
          if(recordError || !recorded?.id)throw Error('Atomic paid order write failed')
          if(!housePayment && !privateConsignment && approvedAssetId && session.metadata?.site==='cafe-sativa' && product.kind==='digital'){
            const {data:asset,error:assetError}=await admin.from('gallery_approved_assets').select('id,product_id,revoked_at').eq('id',approvedAssetId).eq('product_id',productId).maybeSingle()
            if(assetError || !asset || asset.revoked_at)throw Error('Purchased edition requires reconciliation')
            const {error:mappingError}=await admin.from('gallery_private_deliveries').upsert({
              order_id:recorded.id,product_id:productId,approved_asset_id:asset.id,object_path:recorded.id+'/'+asset.id
            },{onConflict:'order_id',ignoreDuplicates:true})
            if(mappingError)throw Error('Digital entitlement assignment failed')
            const {data:mapping,error:readError}=await admin.from('gallery_private_deliveries').select('product_id,approved_asset_id').eq('order_id',recorded.id).maybeSingle()
            if(readError || mapping?.product_id!==productId || mapping?.approved_asset_id!==asset.id)throw Error('Digital entitlement mismatch')
          }
          if(!recorded.created)break
          const order={id:recorded.id}
          if (galleryMode === 'production') try {
            const { sendOrderConfirmation } = await import('@/lib/email/send-order-confirmation')
            await sendOrderConfirmation({
              to: session.customer_details?.email || session.customer_email || '',
              orderId: order.id, productTitle: product.title, productKind: product.kind,
              priceCents: lineTotal / quantity, quantity, totalCents: session.amount_total ?? lineTotal,
              digitalDeliveryUrl: null, fulfillmentState, // Never email permanent artist-supplied delivery URLs.
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
        if (session.mode !== 'subscription' || !stripeCustomerId) break
        await syncCafeMembership(admin,stripe,{
          userId,subscriptionId:stripeSubscriptionId,mode:'checkout',expectedCustomer:stripeCustomerId,expectedTier:tier,
        })
        const releaseId=session.metadata?.music_release_id
        if(session.metadata?.site==='cafe-sativa' && releaseId && /^[0-9a-f-]{36}$/i.test(releaseId) && session.payment_status==='paid' && session.currency==='usd' && Number.isSafeInteger(session.amount_total) && (session.amount_total||0)>0){
          const release=await admin.from('cs_music_releases').select('id,status').eq('id',releaseId).eq('status','approved').maybeSingle()
          if(release.error)throw Error('Music attribution lookup unavailable')
          if(release.data){
            const receipt=await admin.from('cs_music_conversions').upsert({stripe_session_id:session.id,release_id:releaseId,stripe_subscription_id:stripeSubscriptionId,amount_cents:session.amount_total,currency:'usd'},{onConflict:'stripe_session_id',ignoreDuplicates:true})
            if(receipt.error)throw Error('Music attribution receipt unavailable')
          }
        }

        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const receivedSub = event.data.object as Stripe.Subscription
        // Resolve legacy records only by the exact linked subscription/customer.
        let userId = receivedSub.metadata?.user_id
        if (!userId) {
          const customer = typeof receivedSub.customer === 'string' ? receivedSub.customer : receivedSub.customer.id
          const {data: existing,error} = await admin.from('memberships').select('user_id')
            .eq('stripe_subscription_id',receivedSub.id).eq('stripe_customer_id',customer).maybeSingle()
          if (error) throw error
          if (!existing) break
          userId = existing.user_id
        }
        await syncCafeMembership(admin,stripe,{userId:userId!,subscriptionId:receivedSub.id,mode:'subscription'})
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null
        if (!paymentIntentId) break
        // Existing ticket identity takes precedence on shared ingress. A ticket
        // refund (including a replay or partial refund) must never depend on
        // Gallery tables or provider refund enumeration.
        if (galleryMode !== 'isolated-test') {
          const {data:ticket,error:ticketLookupError}=await admin.from('tickets').select('id,state').eq('stripe_payment_intent_id',paymentIntentId).maybeSingle()
          if(ticketLookupError)throw ticketLookupError
          if(ticket){
            if(charge.refunded && ticket.state!=='refunded'){
              const {error:ticketRefundError}=await admin.from('tickets').update({state:'refunded'}).eq('id',ticket.id)
              if(ticketRefundError)throw ticketRefundError
              console.log(`[stripe-webhook] Ticket ${ticket.id} refunded`)
            }
            break
          }
        }
        if (galleryMode === 'blocked') break
        // Revoke a fully refunded Gallery order before collecting financial
        // evidence. A ledger failure remains retryable, not an access grant.
        if (charge.refunded) {
          const {error:orderRefundError}=await admin.from('orders').update({fulfillment_state:'refunded',updated_at:new Date().toISOString()}).eq('stripe_payment_intent_id',paymentIntentId)
          if(orderRefundError)throw orderRefundError
        }
        await recordGalleryRefunds(stripe,charge)
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
          onboarding_state: onboardingState, // Editorial approval is independent of Stripe readiness.
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


