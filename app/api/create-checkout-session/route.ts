import { NextResponse } from 'next/server'
import Stripe from 'stripe'

type Plan = 'insider' | 'founder'

export async function POST(req: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

    if (!stripeSecretKey) {
      return NextResponse.json(
        { error: 'Missing STRIPE_SECRET_KEY' },
        { status: 500 }
      )
    }

    if (!siteUrl) {
      return NextResponse.json(
        { error: 'Missing NEXT_PUBLIC_SITE_URL' },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => null)
    const plan = body?.plan as Plan | undefined

    if (plan !== 'insider' && plan !== 'founder') {
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400 }
      )
    }

    const priceId =
      plan === 'founder'
        ? process.env.STRIPE_PRICE_FOUNDING
        : process.env.STRIPE_PRICE_INSIDER

    if (!priceId) {
      return NextResponse.json(
        { error: `Missing Stripe price for ${plan}` },
        { status: 500 }
      )
    }

    const stripe = new Stripe(stripeSecretKey)

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/membership?success=true`,
      cancel_url: `${siteUrl}/membership?canceled=true`,
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
      raw: error,
    })

    return NextResponse.json(
      {
        error:
          error?.message ||
          error?.raw?.message ||
          error?.code ||
          'Checkout failed',
      },
      { status: 500 }
    )
  }
}
