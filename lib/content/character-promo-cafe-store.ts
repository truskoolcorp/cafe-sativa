import type { CafeDispatchDeps, CafeSchedule } from './character-promo-cafe-metricool'
import { cafeScheduleDigest, cafeReservationKeys } from './character-promo-cafe-metricool'
import { assertNoKnownExternalPromo } from './character-promo-known-external'
/** Inject an existing bounded, abort-aware, retry(false) RPC client. No credentials or grants. */
export type CafeStoreRpc = (name: 'cs_preflight_cafe_metricool'|'cs_claim_cafe_metricool'|'cs_identity_cafe_metricool'|'cs_finish_cafe_metricool', args: Record<string,unknown>) => Promise<{data:unknown;error:unknown}>
/** One immutable reviewed plan per adapter. Missing/uncertain results never permit resubmission. */
export function createCafeMetricoolStore(input:CafeSchedule, rpc:CafeStoreRpc):CafeDispatchDeps['store'] {
 const s=JSON.parse(JSON.stringify(input)) as CafeSchedule
 const digest=cafeScheduleDigest(s), keys=cafeReservationKeys(s)
 const plan=(id:string)=>{if(id!==s.planId)throw Error('Foreign Café plan')}
 return {
 async claim(v){
  plan(v.planId)
  if(v.digest!==digest||v.destinationTimeKey!==keys.destinationTimeKey||v.mediaDestinationKey!==keys.mediaDestinationKey)throw Error('Café reservation binding mismatch')
  assertNoKnownExternalPromo(s)
  const r=await rpc('cs_claim_cafe_metricool',{p_plan:s.planId,p_digest:digest,p_destination:keys.destinationTimeKey,p_media:keys.mediaDestinationKey})
  if(r.error)throw Error('Café claim unconfirmed; do not retry')
  if(r.data===null)return null
  if(typeof r.data!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.data))throw Error('Café claim receipt invalid; do not retry')
  return r.data
 },
 async recordIdentity(id,token,identity){plan(id);const r=await rpc('cs_identity_cafe_metricool',{p_plan:id,p_token:token,p_id:identity.providerId,p_uuid:identity.providerUuid});return !r.error&&r.data===true},
 async finish(id,token,state,receipt){plan(id);const r=await rpc('cs_finish_cafe_metricool',{p_plan:id,p_token:token,p_state:state,p_receipt:receipt});return !r.error&&r.data===true}
 }
}

/** Compose SQL-owned final QA authority with fresh external canonical/bytes/account proof.
 * External verification is required, not an optional bypass. No approvals are created. */
export function createCafeMetricoolAuthority(rpc:CafeStoreRpc, verifyExternal:CafeDispatchDeps['authorize']):CafeDispatchDeps['authorize'] {
 return async(input,digest)=>{
  const s=JSON.parse(JSON.stringify(input)) as CafeSchedule
  if(cafeScheduleDigest(s)!==digest)throw Error('Café authority digest mismatch')
  assertNoKnownExternalPromo(s)
  await verifyExternal(JSON.parse(JSON.stringify(s)),digest)
  const result=await rpc('cs_preflight_cafe_metricool',{p_plan:s.planId,p_digest:digest})
  if(result.error||result.data!==true)throw Error('Café final approval unavailable')
  assertNoKnownExternalPromo(s)
 }
}
