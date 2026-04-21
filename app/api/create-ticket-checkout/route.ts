import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/create-ticket-checkout
 *
 * Body: { event_id: uuid }
 *
 * Three paths:
 *
 *   1. Duplicate ticket → 409. Don't double-issue tickets for the same
 *      user + event.
 *
 *   2. Free-via-tier (or price=0 event) → write tickets row directly
 *      with source='tier_included' and state='valid'. Return
 *      { granted: true }. Skips Stripe entirely — this is the
 *      "Regular/VIP attends free" flow.
 *
 *   3. Paid ticket → create a Stripe Checkout session in 'payment'
 *      mode (NOT subscription). Attach metadata:
 *        kind: 'ticket',
 *        event_id,
 *        user_id
 *      so the webhook can route the completion back here. Return { url }.
 *
 * The ticket row itself is NOT written for the paid path until the
 * webhook confirms payment — otherwise a user who abandons Stripe mid-
 * flow would occupy a capacity slot with no payment.
 */
export async function POST(req: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

    if (!stripeSecretKey) {
      return NextResponse.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 })
    }
    if (!siteUrl) {
      return NextResponse.json({ error: 'Missing NEXT_PUBLIC_SITE_URL' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    const eventId = body?.event_id as string | undefined
    if (!eventId || typeof eventId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid event_id.' },
        { status: 400 }
      )
    }

    // Require signed-in user
    const supabase = createServerSupabase()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) {
      return NextResponse.json(
        { error: 'Please sign in first.', code: 'not_authenticated' },
        { status: 401 }
      )
    }
    const userId = userData.user.id
    const userEmail = userData.user.email

    if (!userEmail) {
      return NextResponse.json(
        { error: 'Your account has no email on file.' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()

    // Load the event (admin client bypasses RLS so we see all statuses,
    // not just scheduled/live — but we still enforce status ourselves)
    const { data: event, error: eventError } = await admin
      .from('events')
      .select(
        'id, slug, title, status, ticket_price_cents, free_for_tiers, capacity, starts_at'
      )
      .eq('id', eventId)
      .maybeSingle()

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
    }

    if (event.status !== 'scheduled' && event.status !== 'live') {
      return NextResponse.json(
        { error: `This event is not currently open for ticketing (status: ${event.status}).` },
        { status: 400 }
      )
    }

    // Check for existing ticket (prevents double-issue)
    const { data: existingTicket } = await admin
      .from('tickets')
      .select('id, state')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingTicket && existingTicket.state !== 'refunded') {
      // The UI shouldn't ask if user is already ticketed, but if something
      // races or the user opens two tabs, respond cleanly.
      return NextResponse.json(
        {
          error: 'You already have a ticket to this event.',
          code: 'already_ticketed',
        },
        { status: 409 }
      )
    }

    // Look up user's tier to decide the path
    const { data: membership } = await admin
      .from('memberships')
      .select('tier, status, stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()

    const userTier = membership?.tier ?? 'explorer'
    const membershipActive = !membership || membership.status === 'active'
    const tierIncludes =
      membershipActive &&
      Array.isArray(event.free_for_tiers) &&
      event.free_for_tiers.includes(userTier)
    const freeEvent = event.ticket_price_cents === 0

    // --- Path 1 + 2: tier-included or free event → direct grant ---
    if (tierIncludes || freeEvent) {
      const ticketSource: 'tier_included' | 'comp' =
        freeEvent && !tierIncludes ? 'comp' : 'tier_included'

      const { error: insertError } = await admin.from('tickets').insert({
        event_id: eventId,
        user_id: userId,
        source: ticketSource,
        state: 'valid',
        amount_paid_cents: 0,
      })

      if (insertError) {
        console.error('[ticket-checkout] Failed to grant free ticket', insertError)
        return NextResponse.json(
          { error: 'Could not issue ticket.' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        granted: true,
        source: ticketSource,
      })
    }

    // --- Path 3: paid checkout ---
    const stripe = new Stripe(stripeSecretKey)

    // Reuse the user's existing Stripe customer_id if we have one on
    // their membership row (from a previous subscription). Otherwise
    // let Stripe create a guest customer tied to their email.
    const existingStripeCustomerId = membership?.stripe_customer_id || null

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: event.ticket_price_cents,
            product_data: {
              name: `Ticket — ${event.title}`,
              description: `Admission to ${event.title}`,
            },
          },
          quantity: 1,
        },
      ],
      ...(existingStripeCustomerId
        ? { customer: existingStripeCustomerId }
        : { customer_email: userEmail }),
      allow_promotion_codes: true,
      metadata: {
        kind: 'ticket',
        event_id: event.id,
        event_slug: event.slug,
        user_id: userId,
      },
      // We set PaymentIntent metadata too so the webhook has it
      // regardless of which object type fires first.
      payment_intent_data: {
        metadata: {
          kind: 'ticket',
          event_id: event.id,
          event_slug: event.slug,
          user_id: userId,
        },
      },
      success_url: `${siteUrl}/events/${event.slug}?success=1`,
      cancel_url: `${siteUrl}/events/${event.slug}?canceled=1`,
    })

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
    })
  } catch (error: any) {
    console.error('TICKET CHECKOUT ERROR:', {
      message: error?.message,
      type: error?.type,
      code: error?.code,
    })
    return NextResponse.json(
      {
        error: error?.message || 'Ticket checkout failed',
      },
      { status: 500 }
    )
  }
}
