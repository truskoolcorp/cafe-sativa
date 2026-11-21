type ShippingRule = {
  rateId: string
  amountCents: number
  country: 'US'
  mode: 'customer_paid' | 'included'
}

/** One-item domestic quotes only; missing, malformed or expired rules never imply free shipping. */
export function galleryShippingRule(
  raw: string | undefined,
  productId: string,
  quantity: number,
  currency: string,
  now = Date.now(),
): ShippingRule | null {
  if (!raw || raw.length > 24_000 || quantity !== 1 || currency !== 'usd' || !Number.isFinite(now)) return null
  try {
    const config = JSON.parse(raw)
    if (!config || Array.isArray(config) || !Object.prototype.hasOwnProperty.call(config, productId)) return null
    const rule = config[productId]
    if (!rule || typeof rule.rateId !== 'string' || !/^shr_[a-zA-Z0-9]{1,100}$/.test(rule.rateId) ||
        rule.country !== 'US' || !Number.isSafeInteger(rule.amountCents) ||
        !Number.isFinite(Date.parse(rule.expiresAt)) || Date.parse(rule.expiresAt) <= now ||
        typeof rule.approvalRef !== 'string' || !rule.approvalRef.trim() ||
        !(rule.mode === 'customer_paid' && rule.amountCents > 0 ||
          rule.mode === 'included' && rule.amountCents === 0)) return null
    return { rateId: rule.rateId, amountCents: rule.amountCents, country: 'US', mode: rule.mode }
  } catch { return null }
}
