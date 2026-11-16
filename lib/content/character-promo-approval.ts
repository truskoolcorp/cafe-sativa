import { prepareCharacterPromo, promoSnapshotDigest, PromoSources } from './character-promo-delivery'

/** Dormant server-only confirmation adapter. No route exposes this function.
 * Future UI must show the exact snapshot, then send only planId + reviewedDigest.
 * Same-origin/CSRF checks belong to that future route. Never accept actor/approval
 * timestamps, media, caption, canon, or a full snapshot from request JSON.
 */
export async function approveCharacterPromo(
  input: {planId: string; reviewedDigest: string},
  deps: {
    auth: {getUser(): Promise<{data: {user: {id: string; app_metadata?: Record<string,unknown>} | null}; error: unknown}>}
    readSources(planId: string): Promise<PromoSources>
    rpc(name: string,args: Record<string,unknown>): PromiseLike<{data: unknown; error: unknown}>
    now(): number
  },
) {
  if(!/^[a-f0-9-]{36}$/i.test(input.planId)||!/^[a-f0-9]{64}$/.test(input.reviewedDigest))throw new Error('Invalid reviewed plan')
  const {data,error}=await deps.auth.getUser()
  const user=data?.user
  if(error||!user||user.app_metadata?.cafe_sativa_admin!==true)throw new Error('Authenticated content admin required')
  const sources=await deps.readSources(input.planId)
  if(sources.plan.id!==input.planId)throw new Error('Plan identity mismatch')
  const snapshot=prepareCharacterPromo(sources,deps.now())
  const digest=promoSnapshotDigest(snapshot)
  if(digest!==input.reviewedDigest)throw new Error('Review changed; explicit approval required again')
  const approvedAt=new Date(deps.now()).toISOString()
  const result=await deps.rpc('cs_approve_character_promo',{p_plan_id:input.planId,p_digest:digest,p_snapshot:snapshot,p_approved_at:approvedAt,p_actor:user.id})
  if(result.error)throw new Error('Approval was not confirmed; refresh before retrying')
  // SQL proposal returns true only for a durable approval insertion, never a dispatch.
  if(result.data!==true)throw new Error('Approval persistence unconfirmed')
  return {planId:input.planId,digest,approvedAt,scheduled:false,published:false}
}
