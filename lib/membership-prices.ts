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
export function cafeSubscriptionTier(sub: {items?: {data?: {price?: {id?: string}}[]}; metadata?: Record<string,string>}) {
  if(sub.metadata?.site && sub.metadata.site !== 'cafe-sativa') return null
  const items=sub.items?.data
  if(!items || items.length!==1)return null
  const priceId=items[0].price?.id || ''
  if(!Object.prototype.hasOwnProperty.call(CAFE_MEMBERSHIP_PRICES,priceId))return null
  const tier=CAFE_MEMBERSHIP_PRICES[priceId]
  if(!tier || (sub.metadata?.tier && sub.metadata.tier!==tier))return null
  return tier
}
