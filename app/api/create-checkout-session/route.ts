import { NextResponse } from 'next/server'
import Stripe from 'stripe'

export async function POST(req: Request) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
    })

    const { plan } = await req.json()

    const priceId =
      plan === 'founder'
        ? process.env.STRIPE_PRICE_FOUNDING
        : process.env.STRIPE_PRICE_INSIDER

    if (!priceId) {
      return NextResponse.json(
        { error: 'Missing price ID' },
        { status: 500 }
      )
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/membership?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/membership?canceled=true`,
    })

    if (!session.url) {
      return NextResponse.json(
        { error: 'Stripe did not return a checkout URL.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('STRIPE ERROR:', error)

    return NextResponse.json(
      {
        error:
          error?.message ||
          error?.raw?.message ||
          'Checkout failed.',
      },
      { status: 500 }
    )
  }
}
