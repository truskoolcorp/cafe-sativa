import type Stripe from 'stripe'

// Server-controlled exact IDs only; a submitter's name, slug, or metadata never grants house handling.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const account = /^acct_[A-Za-z0-9]+$/

export function galleryHouseConfig(env = process.env) {
  const productId = env.GALLERY_HOUSE_PRODUCT_ID
  const artistId = env.GALLERY_HOUSE_ARTIST_ID
  const accountId = env.GALLERY_HOUSE_STRIPE_ACCOUNT_ID
  if (!productId || !artistId || !accountId ||
      !uuid.test(productId) || !uuid.test(artistId) || !account.test(accountId)) return null
  return {productId, artistId, accountId}
}

/** Public launch policy: only this exact studio offer, never arbitrary approved inventory. */
export function galleryDebutOffer(product: {
  id: string; slug: string; kind: string; price_cents: number; currency: string
}, env = process.env) {
  const house = galleryHouseConfig(env)
  return env.GALLERY_HOUSE_CHECKOUT_ENABLED === 'true' && !!house &&
    product.id === house.productId && product.slug === 'where-the-brass-meets-the-tide' &&
    product.kind === 'digital' && product.price_cents === 1200 && product.currency === 'usd'
}

export function gallerySellerKind(productId: string, artistId: string, kind: string, env = process.env) {
  if (productId !== env.GALLERY_HOUSE_PRODUCT_ID && artistId !== env.GALLERY_HOUSE_ARTIST_ID) return 'consigned'
  const house = galleryHouseConfig(env)
  return house && productId === house.productId && artistId === house.artistId && kind === 'digital' ? 'house' : 'blocked'
}

export async function verifiedGalleryHouseAccount(stripe: Stripe, expectedId: string, newSale: boolean) {
  const merchant = await stripe.accounts.retrieveCurrent()
  return merchant.id === expectedId && (!newSale || (merchant.charges_enabled && merchant.payouts_enabled))
}
