import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/gallery/checkout
 *
 * Creates a Stripe Checkout Session for a single-item purchase from
 * the gallery. Uses Connect destination charges: the platform
 * (cafe-sativa) is the merchant of record, the funds land in the
 * platform balance, then Stripe auto-transfers (100% - fee) to
 * the artist's connected account.
 *
 * Why single-item for v1:
 *   - Most gallery purchases will be single pieces
 *   - Mixed carts with items from multiple artists require separate
 *     transfer_data per item, which Stripe Checkout doesn't support
 *     in one session. You'd have to create separate PaymentIntents
 *     per artist. We'll cross that bridge when cart matters.
 *
 * Request body:
 *   {
 *     product_id: uuid,
 *     quantity?: number (default 1)
 *   }
 *
 * Shipping collection:
 *   - physical products → shipping_address_collection enabled
 *   - digital/nft → no shipping
 *
 * Platform fee:
 *   10% of subtotal. Hardcoded for v1. Could become a per-artist
 *   override later (e.g. featured artists get 5%).
 */

const PLATFORM_FEE_BPS = 1000 // 10.00%

type Body = {
  product_id: string
  quantity?: number
}

export async function POST(req: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: 'Stripe is not configured.' },
      { status: 503 }
    )
  }

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  )

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    // v1 requires auth so we can track the order to the user.
    // Guest checkout is a later addition.
    return NextResponse.json(
      {
        error: 'Sign in to complete your purchase.',
        code: 'not_authenticated',
      },
      { status: 401 }
    )
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  if (!body.product_id) {
    return NextResponse.json(
      { error: 'product_id is required.' },
      { status: 400 }
    )
  }

  const quantity = Math.max(1, Math.min(body.quantity ?? 1, 10))

  const admin = createAdminClient()

  // Fetch product + artist in one query via the admin client (bypasses
  // RLS so we can validate even draft/unapproved combinations and
  // return a precise error).
  const { data: product, error: productError } = await admin
    .from('products')
    .select(
      `
      id, title, description, kind, status, price_cents, currency,
      primary_image_url, stock_count, digital_delivery_url,
      artist:artists!inner (
        id, display_name, stripe_account_id, is_approved,
        payouts_enabled, charges_enabled
      )
    `
    )
    .eq('id', body.product_id)
    .maybeSingle()

  if (productError || !product) {
    return NextResponse.json(
      { error: 'Product not found.' },
      { status: 404 }
    )
  }

  if (product.status !== 'published') {
    return NextResponse.json(
      { error: 'This product is not available for purchase.' },
      { status: 400 }
    )
  }

  // The PostgREST embed returns artist as an array in some shapes and
  // as a single object in others depending on the query. Normalize.
  const artistRow = Array.isArray(product.artist)
    ? product.artist[0]
    : (product.artist as any)
  if (!artistRow) {
    return NextResponse.json(
      { error: 'Artist record is missing.' },
      { status: 500 }
    )
  }

  if (!artistRow.is_approved || !artistRow.charges_enabled) {
    return NextResponse.json(
      {
        error:
          'This artist has not finished onboarding. The item will return to sale shortly.',
        code: 'artist_not_ready',
      },
      { status: 400 }
    )
  }

  if (!artistRow.stripe_account_id) {
    return NextResponse.json(
      { error: 'Artist payout account is missing.' },
      { status: 500 }
    )
  }

  // Stock check. null = unlimited.
  if (
    product.stock_count !== null &&
    product.stock_count !== undefined &&
    product.stock_count < quantity
  ) {
    return NextResponse.json(
      { error: 'Not enough stock.', code: 'insufficient_stock' },
      { status: 400 }
    )
  }

  const lineTotal = product.price_cents * quantity
  const applicationFee = Math.floor((lineTotal * PLATFORM_FEE_BPS) / 10000)

  const stripe = new Stripe(stripeSecretKey)
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://www.cafe-sativa.com'

  const isPhysical = product.kind === 'physical'

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'hosted',
      line_items: [
        {
          quantity,
          price_data: {
            currency: product.currency || 'usd',
            unit_amount: product.price_cents,
            product_data: {
              name: product.title,
              description: product.description ?? undefined,
              images: product.primary_image_url
                ? [product.primary_image_url]
                : undefined,
            },
          },
        },
      ],
      // Destination charge — platform collects, then transfers net
      // to the artist's connected account. Application fee is in
      // cents on the base currency.
      payment_intent_data: {
        application_fee_amount: applicationFee,
        transfer_data: {
          destination: artistRow.stripe_account_id,
        },
        metadata: {
          kind: 'gallery_order',
          product_id: product.id,
          artist_id: artistRow.id,
          user_id: authData.user.id,
        },
      },
      metadata: {
        kind: 'gallery_order',
        product_id: product.id,
        artist_id: artistRow.id,
        user_id: authData.user.id,
        quantity: String(quantity),
      },
      customer_email: authData.user.email ?? undefined,
      // Only collect shipping for physical goods
      shipping_address_collection: isPhysical
        ? { allowed_countries: ['US', 'CA', 'MX', 'ES', 'GB'] }
        : undefined,
      phone_number_collection: isPhysical ? { enabled: true } : undefined,
      success_url: `${siteUrl}/gallery/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/gallery/${product.id}?canceled=1`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('[gallery/checkout] session create failed', err)
    return NextResponse.json(
      { error: err?.message || 'Could not start checkout.' },
      { status: 500 }
    )
  }
}
