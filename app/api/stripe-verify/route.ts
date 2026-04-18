import { NextResponse } from 'next/server'
import Stripe from 'stripe'

export async function GET() {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    const insider = process.env.STRIPE_PRICE_INSIDER
    const founding = process.env.STRIPE_PRICE_FOUNDING

    if (!stripeSecretKey) {
      return NextResponse.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 })
    }

    const stripe = new Stripe(stripeSecretKey)

    const result: any = {
      insider: null,
      founding: null,
    }

    if (insider) {
      try {
        const price = await stripe.prices.retrieve(insider)
        result.insider = {
          ok: true,
          id: price.id,
          active: price.active,
          currency: price.currency,
          unit_amount: price.unit_amount,
          recurring: price.recurring,
          product: price.product,
        }
      } catch (e: any) {
        result.insider = {
          ok: false,
          error: e?.message || 'Failed to retrieve Insider price',
        }
      }
    } else {
      result.insider = { ok: false, error: 'Missing STRIPE_PRICE_INSIDER' }
    }

    if (founding) {
      try {
        const price = await stripe.prices.retrieve(founding)
        result.founding = {
          ok: true,
          id: price.id,
          active: price.active,
          currency: price.currency,
          unit_amount: price.unit_amount,
          recurring: price.recurring,
          product: price.product,
        }
      } catch (e: any) {
        result.founding = {
          ok: false,
          error: e?.message || 'Failed to retrieve Founding price',
        }
      }
    } else {
      result.founding = { ok: false, error: 'Missing STRIPE_PRICE_FOUNDING' }
    }

    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Stripe verify failed' },
      { status: 500 }
    )
  }
}
