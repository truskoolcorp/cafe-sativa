import type {ProductionRpc} from './character-production-store'
import type {ReplenishmentStore} from './character-production-replenishment'
/** Only the three offline-proposed RPCs. No live grant/client fallback. */
export function createReplenishmentStore(rpc:ProductionRpc):ReplenishmentStore{
 return {
 async claim(v){const r=await rpc.rpc('character_production_text_claim',{p_key:v.key,p_digest:v.sourceDigest,p_source:v.source,p_budget:v.lease.id,p_period:v.lease.period,p_quote:v.lease.maxCostCents,p_cap:v.lease.monthlyCapCents,p_rate:v.lease.rateEvidence,p_expires:v.lease.expiresAt,p_input_rate:v.lease.inputMicroUsdPerToken,p_output_rate:v.lease.outputMicroUsdPerToken});if(r.error)throw Error('Text claim unknown');if(r.data===null)return null;if(typeof r.data!=='string'||!/^[a-f0-9-]{36}$/.test(r.data))throw Error('Text claim malformed');return r.data},
 async authorize(v){const r=await rpc.rpc('character_production_text_authorized',{p_key:v.key,p_token:v.token,p_digest:v.sourceDigest,p_budget:v.lease.id,p_expires:v.lease.expiresAt,p_input_rate:v.lease.inputMicroUsdPerToken,p_output_rate:v.lease.outputMicroUsdPerToken,p_quote:v.lease.maxCostCents,p_cap:v.lease.monthlyCapCents,p_rate:v.lease.rateEvidence});return !r.error&&r.data===true},
 async save(v){const r=await rpc.rpc('character_production_text_save',{p_key:v.key,p_token:v.token,p_digest:v.sourceDigest,p_output:v.output,p_provider:v.providerId,p_input:v.inputTokens,p_output_tokens:v.outputTokens});return !r.error&&r.data===true},
 }
}
