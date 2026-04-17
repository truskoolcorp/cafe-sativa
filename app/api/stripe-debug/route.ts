import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    hasStripeSecretKey: Boolean(process.env.STRIPE_SECRET_KEY),
    hasStripePriceInsider: Boolean(process.env.STRIPE_PRICE_INSIDER),
    hasStripePriceFounding: Boolean(process.env.STRIPE_PRICE_FOUNDING),
    hasSiteUrl: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
  })
}
