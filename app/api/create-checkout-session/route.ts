import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CAFE_MEMBERSHIP_PRICES } from '@/lib/membership-prices'

type Tier = 'regular' | 'vip'

/**
 * POST /api/create-checkout-session
 *
 * Body: { tier: 'regular' | 'vip' }
 *
 * Flow:
 *   1. Resolve the signed-in Supabase user via the SSR cookie helper.
 *   2. Reject if unauthenticated — we can't create a subscription without
 *      a user to attach it to.
 *   3. Look up (or create) the Stripe customer for this user.
 *   4. Create a Stripe Checkout Session with:
 *      - subscription mode
 *      - the correct price for the tier
 *      - customer_email or customer (if we have a Stripe customer already)
 *      - metadata.user_id + metadata.tier so the webhook can route correctly
 *      - subscription_data.metadata.user_id + .tier so the same info flows
 *        onto the Subscription object (webhook fires on subscription.* too)
 *   5. Return { url } for the client to redirect to.
 */
export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) {
    return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 })
  }
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

    if (!stripeSecretKey) {
      return NextResponse.json(
        { error: 'Membership checkout is temporarily unavailable.' },
        { status: 500 }
      )
    }
    if (!siteUrl) {
      return NextResponse.json(
        { error: 'Membership checkout is temporarily unavailable.' },
        { status: 500 }
      )
    }

    // -- Parse request body --
    const body = await req.json().catch(() => null)
    const tier = body?.tier as Tier | undefined

    if (tier !== 'regular' && tier !== 'vip') {
      return NextResponse.json(
        { error: 'Invalid tier. Expected "regular" or "vip".' },
        { status: 400 }
      )
    }

    // -- Resolve price for the tier --
    // Accept both new (STRIPE_PRICE_{TIER}_MONTHLY) and legacy
    // (STRIPE_PRICE_INSIDER / STRIPE_PRICE_FOUNDING) env names. The
    // legacy names were used by the initial scaffolding; the new names
    // match the DB enum. Either works until Vercel env vars are renamed.
    const priceId =
      tier === 'vip'
        ? process.env.STRIPE_PRICE_VIP_MONTHLY || process.env.STRIPE_PRICE_FOUNDING
        : process.env.STRIPE_PRICE_REGULAR_MONTHLY || process.env.STRIPE_PRICE_INSIDER

    if (!priceId || CAFE_MEMBERSHIP_PRICES[priceId] !== tier) {
      return NextResponse.json(
        { error: 'This membership plan is temporarily unavailable.' },
        { status: 503 }
      )
    }

    // -- Require signed-in user --
    const supabase = createServerSupabase()
    const { data: userData, error: userError } = await supabase.auth.getUser()

    if (userError || !userData?.user) {
      return NextResponse.json(
        { error: 'You need to be signed in to subscribe.', code: 'not_authenticated' },
        { status: 401 }
      )
    }

    const user = userData.user
    const userEmail = user.email

    if (!userEmail) {
      return NextResponse.json(
        { error: 'Your account has no email on file. Please contact support.' },
        { status: 400 }
      )
    }

    // -- Look up existing Stripe customer, if any --
    // We store stripe_customer_id on the memberships table after first checkout.
    // If they've never subscribed before there won't be a row yet — that's fine,
    // we pass customer_email and Stripe will create a new Customer.
    const admin = createAdminClient()
    const { data: existingMembership, error: membershipError } = await admin
      .from('memberships')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json({ error: 'Could not verify your membership. Please retry.' }, { status: 503 })
    }
    // Never start a second subscription while the recorded one can still bill.
    if (existingMembership?.stripe_subscription_id) {
      const current = await new Stripe(stripeSecretKey).subscriptions.retrieve(existingMembership.stripe_subscription_id)
      if (!['canceled', 'incomplete_expired'].includes(current.status)) {
        return NextResponse.json({
          error: 'You already have a subscription. Contact support to change your plan or resolve payment; do not purchase another membership.',
          code: 'existing_subscription',
        }, { status: 409 })
      }
    }

    const existingCustomerId = existingMembership?.stripe_customer_id || null

    const stripe = new Stripe(stripeSecretKey)

    // Verify the live offer against the amount displayed to customers.
    // A legacy founding or annual price must never silently replace monthly checkout.
    const price = await stripe.prices.retrieve(priceId)
    if (!price.active || price.currency !== 'usd' || price.type !== 'recurring' ||
        price.unit_amount !== (tier === 'regular' ? 999 : 2499) ||
        price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1) {
      return NextResponse.json({ error: 'This membership plan is temporarily unavailable.' }, { status: 503 })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Either attach to an existing customer, or let Stripe create one from
      // the email. Don't mix both — Stripe will reject the request.
      ...(existingCustomerId
        ? { customer: existingCustomerId }
        : { customer_email: userEmail }),
      // Allow the customer to change their plan in the customer portal later.
      allow_promotion_codes: true,
      // Attach identifiers to BOTH the session and the subscription it creates.
      metadata: {
        site: 'cafe-sativa',
        user_id: user.id,
        tier,
      },
      subscription_data: {
        metadata: {
          site: 'cafe-sativa',
          user_id: user.id,
          tier,
        },
      },
      // These are read from NEXT_PUBLIC_SITE_URL so they resolve to prod
      // regardless of which Vercel preview URL the request came from.
      success_url: `${siteUrl}/membership?success=1&tier=${tier}`,
      cancel_url: `${siteUrl}/membership?canceled=1`,
    })

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
    })
  } catch (error: any) {
    console.error('STRIPE CHECKOUT ERROR:', {
      message: error?.message,
      type: error?.type,
      code: error?.code,
      param: error?.param,
    })

    return NextResponse.json(
      {
        error: 'Could not start membership checkout. Please retry.',
      },
      { status: 500 }
    )
  }
}

