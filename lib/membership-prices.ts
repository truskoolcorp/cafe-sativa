import { MEMBERSHIP_OFFER_CENTS } from './membership-offers'

// Exact Café Sativa catalog verified in the owner-selected Stripe account.
// Supporting existing subscribers here does not enable new storefront offers.
export const CAFE_MEMBERSHIP_PRICES: Record<string, 'regular' | 'vip'> = {
  price_1TNFwCIDc7LlvDW9siOcRvdd: 'regular',
  price_1TdCcIIDc7LlvDW9OosbW6yG: 'regular',
  price_1TdCcIIDc7LlvDW9fuj3QaNn: 'regular',
  price_1TNFx1IDc7LlvDW9KZvLsnsl: 'vip',
  price_1TdCcJIDc7LlvDW9IT1lsqbo: 'vip',
  price_1TdCcIIDc7LlvDW9ROnqf2HG: 'vip',
}
type PaidTier = 'regular' | 'vip'
type Price = {
  id?: string
  product?: string | { id: string }
  currency?: string
  type?: string
  unit_amount?: number | null
  recurring?: { interval?: string; interval_count?: number; usage_type?: string } | null
}

const products = { regular: 'prod_ULxrCgCmYnTWOF', vip: 'prod_ULxsmvOgLeiyYy' }
export function annualPriceId(tier: PaidTier) {
  const regular = process.env.STRIPE_PRICE_REGULAR_ANNUAL
  const vip = process.env.STRIPE_PRICE_VIP_ANNUAL
  const id = tier === 'regular' ? regular : vip
  if (!id || id === (tier === 'regular' ? vip : regular) || !/^price_[A-Za-z0-9]+$/.test(id) ||
      Object.prototype.hasOwnProperty.call(CAFE_MEMBERSHIP_PRICES, id)) return undefined
  return id
}

export function exactAnnualPrice(tier: PaidTier, price?: Price) {
  if (!price?.id || price.id !== annualPriceId(tier)) return false
  const product = typeof price.product === 'string' ? price.product : price.product?.id
  return product === products[tier] && price.currency === 'usd' && price.type === 'recurring' &&
    price.unit_amount === MEMBERSHIP_OFFER_CENTS[tier].annual && price.recurring?.interval === 'year' &&
    price.recurring.interval_count === 1 && price.recurring.usage_type === 'licensed'
}

export function cafeSubscriptionTier(sub: {items?: {data?: {price?: Price}[]}; metadata?: Record<string,string>}) {
  if(sub.metadata?.site && sub.metadata.site !== 'cafe-sativa') return null
  const items=sub.items?.data
  if(!items || items.length!==1)return null
  const price=items[0].price
  const priceId=price?.id || ''
  const tier=Object.prototype.hasOwnProperty.call(CAFE_MEMBERSHIP_PRICES,priceId)
    ? CAFE_MEMBERSHIP_PRICES[priceId]
    : exactAnnualPrice('regular',price) ? 'regular' : exactAnnualPrice('vip',price) ? 'vip' : null
  if(!tier || (sub.metadata?.tier && sub.metadata.tier!==tier))return null
  return tier
}
