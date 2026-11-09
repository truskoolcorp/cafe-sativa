import { PromoDeliveryStore } from './character-promo-delivery'

type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}> }
/** Only usable after reviewed offline SQL proposal is applied. Never fall back to
 * direct table writes or treat an RPC/network failure as an unclaimed attempt. */
export function characterPromoDeliveryStore(db: RpcClient): PromoDeliveryStore {
  return {
    async claim({planId,digest,approval}) {
      const result=await db.rpc('cs_claim_character_promo',{p_plan_id:planId,p_digest:digest,p_snapshot:approval.snapshot})
      if(result.error)throw new Error('Atomic persona claim unavailable; do not submit')
      if(result.data===null)return null
      if(typeof result.data!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.data))throw new Error('Uncertain persona claim result; do not submit')
      return result.data
    },
    async finish({planId,token,state,receipt}) {
      const result=await db.rpc('cs_finish_character_promo',{p_plan_id:planId,p_token:token,p_state:state,p_receipt:receipt})
      if(result.error)throw new Error('Persona receipt persistence uncertain; do not resubmit')
      return result.data===true
    },
  }
}

/** Read immutable approval through narrow service-only RPC, never private table grants. */
export async function readCharacterPromoApproval(db: RpcClient, planId: string) {
  const result=await db.rpc('cs_read_character_promo_approval',{p_plan_id:planId})
  if(result.error)throw new Error('Persona approval unavailable')
  const a=result.data as import('./character-promo-delivery').PromoApproval | null
  if(!a)return null
  if(typeof a!=='object'||!a.snapshot||a.snapshot.planId!==planId||typeof a.digest!=='string'||!/^[a-f0-9]{64}$/.test(a.digest)||typeof a.approvedBy!=='string'||!a.approvedBy||typeof a.approvedAt!=='string'||!Number.isFinite(Date.parse(a.approvedAt))||a.revokedAt!==null)throw new Error('Invalid persona approval record')
  return a
}
