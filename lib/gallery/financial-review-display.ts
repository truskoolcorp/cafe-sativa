// Report evidence is not a payout or an estimate of missing provider values.
export function reportAmount(value: unknown, currency: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return 'Unknown'
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) return 'Unknown'
  const code = currency.toUpperCase()
  // USD is the approved initial sale currency. Preserve exact minor units for
  // other currencies rather than assuming a two-decimal Stripe exponent.
  return code === 'USD' ? new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(value/100) + ' USD'
    : value.toLocaleString('en-US') + ' ' + code + ' minor units'
}
export function reportEvidence(value: unknown): string {
  switch(value) {
    case 'observed': return 'Provider evidence recorded'
    case 'attention': return 'Review required'
    case 'incomplete': return 'Incomplete evidence'
    default: return 'Not yet observed'
  }
}
export function refundReviewReason(value: unknown): string {
  switch(value) {
    case 'provider_refund_evidence_incomplete': return 'Provider refund evidence incomplete'
    case 'unlimited_no_restock': return 'Unlimited inventory — no restock'
    case 'digital_edition_manual_review': return 'Digital edition — manual review'
    case 'physical_return_manual_review': return 'Physical return — manual review'
    default: return 'Manual review required'
  }
}
