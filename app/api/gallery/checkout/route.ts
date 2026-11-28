import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { galleryDebutOffer, galleryHouseConfig, gallerySellerKind, verifiedGalleryHouseAccount } from '@/lib/gallery/house-checkout'
import { galleryEnvironment, gallerySalesEnabled } from '@/lib/gallery/environment'
import { verifyHouseArtworkStorage } from '@/lib/gallery/verify-house-artwork-storage'

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
// The launch authorizes this original only, not any later edition or the public display copy.
const DEBUT_MASTER_SHA256 = '33483b370c172774d73b2a7445322e9973422e90e3cefdbcf0fa6ed01ec06f93'

type Body = {
  product_id: string
  quantity?: number
}

export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) {
    return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 })
  }
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: 'Stripe is not configured.' },
      { status: 503 }
    )
  }

  const mode = galleryEnvironment(req.url)
  if (mode === 'blocked') {
    return NextResponse.json({ error: 'Gallery test checkout is not isolated.' }, { status: 503 })
  }

  if (!gallerySalesEnabled(mode)) {
    return NextResponse.json({ error: 'Gallery purchases are temporarily unavailable.' }, { status: 503 })
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

  if (!body || typeof body.product_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.product_id)) {
    return NextResponse.json(
      { error: 'product_id is required.' },
      { status: 400 }
    )
  }

  const quantity = body.quantity ?? 1
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return NextResponse.json({ error: 'Quantity must be a whole number from 1 to 10.' }, { status: 400 })
  }

  const configuredHouse = galleryHouseConfig()
  if (mode === 'production' && (process.env.GALLERY_HOUSE_CHECKOUT_ENABLED !== 'true' ||
      !configuredHouse || body.product_id !== configuredHouse.productId || quantity !== 1)) {
    return NextResponse.json({ error: 'This artwork is not available for purchase.' }, { status: 409 })
  }

  const admin = createAdminClient()

  // Fetch product + artist in one query via the admin client (bypasses
  // RLS so we can validate even draft/unapproved combinations and
  // return a precise error).
  const { data: product, error: productError } = await admin
    .from('products')
    .select(
      `
      id, artist_id, slug, title, description, kind, status, price_cents, currency,
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

  if (mode === 'production' && !galleryDebutOffer(product)) {
    return NextResponse.json({ error: 'This artwork is not available for purchase.' }, { status: 409 })
  }
  if (!['physical', 'digital'].includes(product.kind)) {
    return NextResponse.json({ error: 'This artwork category is not enabled for purchases.' }, { status: 409 })
  }
  if (product.status !== 'published') {
    return NextResponse.json(
      { error: 'This product is not available for purchase.' },
      { status: 400 }
    )
  }
  if (!Number.isInteger(product.price_cents) || product.price_cents <= 0 ||
      (product.kind !== 'physical' && !product.digital_delivery_url &&
        !(product.kind === 'digital' && process.env.GALLERY_PRIVATE_DOWNLOADS === 'true'))) {
    return NextResponse.json({ error: 'This item is not ready for checkout.' }, { status: 409 })
  }

  // Private delivery preview pins the reviewed edition before payment.
  let approvedAssetId: string | undefined
  let approvedAsset: {id:string;sha256:string;object_path:string} | undefined
  if (product.kind === 'digital' && process.env.GALLERY_PRIVATE_DOWNLOADS === 'true') {
    let assetQuery=admin.from('gallery_approved_assets')
      .select('id,sha256,object_path').eq('product_id',product.id).is('revoked_at',null)
    if(mode==='production') assetQuery=assetQuery.eq('sha256',DEBUT_MASTER_SHA256)
    const {data:assets,error:assetError}=await assetQuery
      .order('approved_at',{ascending:false}).order('id',{ascending:false}).limit(mode==='production'?2:1)
    if(assetError || !assets?.[0] || (mode==='production' &&
       (assets.length!==1 || assets[0].sha256!==DEBUT_MASTER_SHA256)))
      return NextResponse.json({error:'No approved digital edition is available.'},{status:409})
    approvedAsset=assets[0]
    approvedAssetId=assets[0].id
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

  if (process.env.GALLERY_HOUSE_CHECKOUT_ENABLED === 'true' && !configuredHouse) {
    return NextResponse.json({ error: 'House checkout configuration is unavailable.' }, { status: 503 })
  }
  const saleKind = gallerySellerKind(product.id, artistRow.id, product.kind)
  const house = saleKind === 'house' ? configuredHouse : null
  if (mode === 'production' && !house) {
    return NextResponse.json({ error: 'This artwork is not available for purchase.' }, { status: 409 })
  }
  if (stripeSecretKey.startsWith('rkcs_test_') && !house) {
    return NextResponse.json({ error: 'Temporary test credentials support this house fixture only.' }, { status: 409 })
  }
  if (saleKind === 'blocked' || (house && process.env.GALLERY_HOUSE_CHECKOUT_ENABLED !== 'true')) {
    return NextResponse.json({ error: 'This house artwork is not ready for checkout.' }, { status: 409 })
  }

  if (!artistRow.is_approved || (!house && (!artistRow.charges_enabled || !artistRow.payouts_enabled))) {
    return NextResponse.json(
      {
        error:
          'This artist has not finished onboarding. The item will return to sale shortly.',
        code: 'artist_not_ready',
      },
      { status: 400 }
    )
  }

  if (!house && !artistRow.stripe_account_id) {
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
  if (house) {
    if (!approvedAssetId) return NextResponse.json({ error: 'House edition is unavailable.' }, { status: 409 })
    const { data: ready, error: readyError } = await admin.rpc('cs_gallery_house_ready', {
      p_product: product.id, p_artist: artistRow.id, p_asset: approvedAssetId,
    })
    if (readyError || ready !== true) {
      return NextResponse.json({ error: 'House checkout is not ready.' }, { status: 503 })
    }
    // Verify actual readable bytes and both private buckets before reserving stock or creating a session.
    // The exact production master length is pinned in addition to its previously approved SHA-256.
    if (!approvedAsset || !await verifyHouseArtworkStorage(admin,product.id,approvedAsset,mode==='production'?2856592:undefined)) {
      return NextResponse.json({ error: 'House artwork delivery is temporarily unavailable.' }, { status: 503 })
    }
    try {
      if (!await verifiedGalleryHouseAccount(stripe, house.accountId, true)) {
        return NextResponse.json({ error: 'House checkout account is unavailable.' }, { status: 503 })
      }
    } catch {
      return NextResponse.json({ error: 'House checkout account is unavailable.' }, { status: 503 })
    }
  }
  const houseMetadata: Stripe.MetadataParam = house ? { gallery_sale_kind: 'house', gallery_platform_account_id: house.accountId } : {}
  // Durable provider marker; late events cannot silently fall back to legacy writes.
  const settlementMetadata: Stripe.MetadataParam = mode === 'production' ? {
    gallery_settlement_schema:'queue-v1', site:'cafe-sativa',
  } : {}
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://www.cafe-sativa.com'

  const isPhysical = product.kind === 'physical'
  const privateConsignment = !house && !isPhysical && !!approvedAssetId

  let holdId: string | undefined
  if(process.env.GALLERY_INVENTORY_HOLDS==='true'){
    const {data:hold,error:holdError}=await admin.rpc('cs_hold_gallery_inventory',{p_product:product.id,p_user:authData.user.id,p_quantity:quantity})
    if(holdError)return NextResponse.json({error:'Inventory temporarily unavailable.'},{status:503})
    if(!hold)return NextResponse.json({error:'Artwork is currently reserved or sold out.'},{status:409})
    holdId=hold
  }
  if (privateConsignment) {
    if (!holdId) return NextResponse.json({ error: 'Private edition reservation is unavailable.' }, { status: 503 })
    const {data: pinned, error: pinError} = await admin.rpc('cs_pin_consigned_private_gallery_hold', {
      p_hold:holdId, p_product:product.id, p_artist:artistRow.id, p_asset:approvedAssetId,
      p_user:authData.user.id, p_destination:artistRow.stripe_account_id,
      p_subtotal:lineTotal, p_currency:product.currency || 'usd',
    })
    if (pinError || pinned !== true) return NextResponse.json({ error: 'Private edition reservation is unavailable.' }, { status: 503 })
  }
  const privateMetadata: Stripe.MetadataParam = privateConsignment ? {
    gallery_private_schema:'consigned-v1', approved_asset_id:approvedAssetId!, inventory_hold_id:holdId!,
    gallery_transfer_destination:artistRow.stripe_account_id,
  } : {}
  let failurePhase: 'session_create_failed' | 'reservation_link_failed' = 'session_create_failed'
  try {
    const session = await stripe.checkout.sessions.create({
      ...(holdId ? {expires_at:Math.floor(Date.now()/1000)+40*60} : {}),
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
      // Consigned artwork is a destination charge with an application fee.
      // House artwork is a direct charge to the verified platform account.
      payment_intent_data: {
        ...(!house ? {
          application_fee_amount: applicationFee,
          transfer_data: { destination: artistRow.stripe_account_id },
        } : {}),
        metadata: {
          ...houseMetadata,
          ...privateMetadata,
          ...settlementMetadata,
          kind: 'gallery_order',
          product_id: product.id,
          artist_id: artistRow.id,
          user_id: authData.user.id,
        },
      },
      metadata: {
        ...houseMetadata,
          ...privateMetadata,
          ...settlementMetadata,
        kind: 'gallery_order',
        product_id: product.id,
        artist_id: artistRow.id,
        user_id: authData.user.id,
        quantity: String(quantity),
        site: 'cafe-sativa',
        ...(holdId ? {inventory_hold_id:holdId} : {}),
        ...(approvedAssetId ? {approved_asset_id:approvedAssetId} : {}),
      },
      customer_email: authData.user.email ?? undefined,
      // Only collect shipping for physical goods
      shipping_address_collection: isPhysical
        ? { allowed_countries: ['US', 'CA', 'MX', 'ES', 'GB'] }
        : undefined,
      phone_number_collection: isPhysical ? { enabled: true } : undefined,
      success_url: `${siteUrl}/gallery/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/gallery/${product.slug}?canceled=1`,
    },holdId ? {idempotencyKey:'gallery-hold-'+holdId} : undefined)
    if(holdId){
      failurePhase = 'reservation_link_failed'
      const {data:linked,error:linkError}=await admin.from('gallery_inventory_holds').update({stripe_session_id:session.id}).eq('id',holdId).eq('state','held').select('id').maybeSingle()
      if(linkError||!linked)throw Error('Inventory reservation requires reconciliation')
    }

    return NextResponse.json({ url: session.url })
  } catch {
    // Provider and database errors can contain checkout URLs or buyer data.
    // Emit only a fixed phase; never serialize the underlying error.
    console.error('[gallery/checkout] ' + failurePhase)
    return NextResponse.json(
      { error: 'Could not start checkout. Please retry.' },
      { status: 500 }
    )
  }
}
