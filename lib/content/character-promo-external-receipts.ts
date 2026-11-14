/** External scheduling evidence is a suppression record, never app approval,
 * publication confirmation or a synthetic app dispatch attempt. Server-only callers
 * must supply a trusted durable registry, not request-body data. */
export type ExternalPromoReceipt={provider:'metricool';providerId:string;promoId:string;videoSha256:string;brandId:string;network:'facebook'|'instagram';accountId:string;scheduledAt:string;observedAt:string;state:'scheduled'|'published'|'unknown'}
export type PromoDeliveryIdentity={promoId:string;videoSha256:string;brandId:string;network:string;accountId:string}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(v)
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
function valid(r:ExternalPromoReceipt){return r&&r.provider==='metricool'&&[r.providerId,r.promoId,r.brandId,r.accountId].every(id)&&hash(r.videoSha256)&&['facebook','instagram'].includes(r.network)&&date(r.scheduledAt)&&date(r.observedAt)&&['scheduled','published','unknown'].includes(r.state)}
/** Fail closed if registry is unavailable/malformed. Exact account identity prevents
 * confusing Café receipts with older Tru Skool plans. Same bytes at same destination
 * remain blocked even when a draft is copied to a new promo ID or rescheduled.
 * Removal/repost requires separate reviewed reconciliation, never an expiry timer. */
export function externalPromoDeliveryDecision(identity:PromoDeliveryIdentity,receipts:readonly ExternalPromoReceipt[]|null):'clear'|'held'|'already_external' {
 if(!identity||![identity.promoId,identity.brandId,identity.network,identity.accountId].every(id)||!hash(identity.videoSha256)||!Array.isArray(receipts)||!receipts.every(valid))return 'held'
 return receipts.some(r=>r.videoSha256===identity.videoSha256&&r.brandId===identity.brandId&&r.network===identity.network&&r.accountId===identity.accountId)?'already_external':'clear'
}
