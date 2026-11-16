import { NextResponse } from 'next/server'
import Stripe from 'stripe'

/**
 * GET /api/stripe-verify
 *
 * Debugging endpoint. Checks that Stripe env vars resolve and that the
 * prices they point to actually exist in the Stripe account. Both the
 * new names (STRIPE_PRICE_{TIER}_MONTHLY) and the legacy names
 * (STRIPE_PRICE_INSIDER / STRIPE_PRICE_FOUNDING) are accepted as
 * fallbacks to avoid a flag-day rename in Vercel env config.
 */
export async function GET() {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY

    if (!stripeSecretKey) {
      return NextResponse.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 })
    }

    const stripe = new Stripe(stripeSecretKey)

    const regularPriceId =
      process.env.STRIPE_PRICE_REGULAR_MONTHLY || process.env.STRIPE_PRICE_INSIDER || null
    const vipPriceId =
      process.env.STRIPE_PRICE_VIP_MONTHLY || process.env.STRIPE_PRICE_FOUNDING || null

    const result: Record<string, unknown> = {
      env: {
        STRIPE_PRICE_REGULAR_MONTHLY: Boolean(process.env.STRIPE_PRICE_REGULAR_MONTHLY),
        STRIPE_PRICE_VIP_MONTHLY: Boolean(process.env.STRIPE_PRICE_VIP_MONTHLY),
        STRIPE_PRICE_INSIDER_legacy: Boolean(process.env.STRIPE_PRICE_INSIDER),
        STRIPE_PRICE_FOUNDING_legacy: Boolean(process.env.STRIPE_PRICE_FOUNDING),
        STRIPE_WEBHOOK_SECRET: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || null,
        SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      regular: null as unknown,
      vip: null as unknown,
    }

    async function check(priceId: string | null, label: string) {
      if (!priceId) {
        return { ok: false, error: `Missing price id for ${label}` }
      }
      try {
        const price = await stripe.prices.retrieve(priceId)
        return {
          ok: true,
          id: price.id,
          active: price.active,
          currency: price.currency,
          unit_amount: price.unit_amount,
          recurring: price.recurring,
          product: price.product,
        }
      } catch (e: any) {
        return { ok: false, error: e?.message || `Failed to retrieve ${label} price` }
      }
    }

    result.regular = await check(regularPriceId, 'regular')
    result.vip = await check(vipPriceId, 'vip')

    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Stripe verify failed' },
      { status: 500 }
    )
  }
}
