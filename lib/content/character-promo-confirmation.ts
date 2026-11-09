import type { PromoReviewSources } from './character-promo-sources'
import { buildCharacterPromoReview, CONTENT_GATES, ContentGate, PromoGateEvidence, PromoGateState, PromoReviewError, promoReviewDigest } from './character-promo-review'

type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const sha=/^[a-f0-9]{64}$/
function evidenceShape(value:unknown):value is PromoGateEvidence {
  if(!value||typeof value!=='object')return false
  const row=value as PromoGateEvidence
  return typeof row.generationId==='string' && uuid.test(row.generationId) && CONTENT_GATES.includes(row.gate) && typeof row.contentDigest==='string' && sha.test(row.contentDigest) && !!row.content && typeof row.confirmedBy==='string' && uuid.test(row.confirmedBy) && typeof row.confirmedAt==='string' && Number.isFinite(Date.parse(row.confirmedAt)) && typeof row.invalidated==='boolean'
}
function stateShape(value:unknown,planId:string):value is PromoGateState {
  if(!value||typeof value!=='object')return false
  const state=value as PromoGateState
  return typeof state.hasSharedAttempt==='boolean' && typeof state.ownDeliveryApprovalCurrent==='boolean' && Number.isSafeInteger(state.pendingSiblingGatePlans) && state.pendingSiblingGatePlans>=0 && Number.isSafeInteger(state.pendingSiblingDeliveryApprovals) && state.pendingSiblingDeliveryApprovals>=0 && (state.generationId===null || (typeof state.generationId==='string' && uuid.test(state.generationId))) && typeof state.invalidated==='boolean' && Array.isArray(state.gates) && state.gates.length<=3 && state.gates.every(evidenceShape) && state.gates.every(r=>r.content.planId===planId && r.generationId===state.generationId) && (state.generationId!==null || (!state.invalidated && state.gates.length===0))
}
export async function readCharacterPromoGates(db:Rpc,planId:string):Promise<PromoGateState> {
  if(!uuid.test(planId))throw new PromoReviewError('plan_id_invalid','Valid plan UUID required')
  let result
  try {result=await db.rpc('cs_read_character_promo_gates',{p_plan_id:planId})} catch {throw new PromoReviewError('gate_read_failed','Final confirmation evidence could not be read')}
  if(result.error || !stateShape(result.data,planId))throw new PromoReviewError('gate_read_failed','Final confirmation evidence is unavailable or invalid')
  return result.data
}
type ReviewActionDependencies={
  auth:{getUser():Promise<{data:{user:{id:string;app_metadata?:Record<string,unknown>}|null};error:unknown}>}
  readSources(planId:string):Promise<PromoReviewSources>
  db:Rpc
  now():number
}
type ReviewActionInput={planId:string;contentDigest:string;reviewedStateDigest:string;explicitConfirmation:true}
async function currentReview(input:ReviewActionInput,deps:ReviewActionDependencies) {
  if(!uuid.test(input.planId)||!sha.test(input.contentDigest)||!sha.test(input.reviewedStateDigest)||input.explicitConfirmation!==true)throw new PromoReviewError('confirmation_input_invalid','Exact reviewed plan and explicit named confirmation required')
  let auth
  try {auth=await deps.auth.getUser()} catch {throw new PromoReviewError('confirmation_auth_failed','Authenticated content admin required')}
  const user=auth.data?.user
  if(auth.error||!user||!uuid.test(user.id)||user.app_metadata?.cafe_sativa_admin!==true)throw new PromoReviewError('confirmation_auth_failed','Authenticated content admin required')
  let sources:PromoReviewSources
  try {sources=await deps.readSources(input.planId)} catch {throw new PromoReviewError('confirmation_sources_failed','Current reviewed sources are unavailable; no confirmation was requested')}
  if(sources.plan.id!==input.planId)throw new PromoReviewError('confirmation_plan_mismatch','Reviewed plan identity changed')
  const state=await readCharacterPromoGates(deps.db,input.planId)
  const model=buildCharacterPromoReview(sources,state,deps.now())
  if(!model.content || model.contentDigest!==input.contentDigest || model.reviewedStateDigest!==input.reviewedStateDigest)throw new PromoReviewError('confirmation_review_changed','Review changed; refresh and explicitly review again')
  return {user,model,state}
}
/** Explicitly starts or replaces a reviewed generation. Does NOT confirm any content gate.
 * SQL must archive prior consent and forbid replacement once any shared-promo attempt exists.
 */
export async function beginCharacterPromoReview(input:ReviewActionInput & {action:'begin_review'|'replace_review'},deps:ReviewActionDependencies) {
  const {user,model,state}=await currentReview(input,deps)
  if(!['begin_review','replace_review'].includes(input.action)||model.nextAction!==input.action)throw new PromoReviewError('review_generation_not_eligible','This review cannot start a new version; refresh its evidence')
  let result
  try {result=await deps.db.rpc('cs_begin_character_promo_review',{p_plan_id:input.planId,p_content:model.content,p_digest:model.contentDigest,p_expected:model.expected,p_actor:user.id})} catch {throw new PromoReviewError('review_generation_outcome_unknown','Review version outcome is unknown; refresh before retrying')}
  if(result.error||!stateShape(result.data,input.planId)||!result.data.generationId||result.data.generationId===state.generationId||result.data.invalidated||result.data.gates.length)throw new PromoReviewError('review_generation_outcome_unknown','New review version was not verified; refresh before retrying')
  return {review:result.data,contentApproved:false as const,deliveryApproved:false as const,scheduled:false as const,published:false as const}
}
/** Dormant explicit action adapter. A future route needs same-origin/CSRF protection.
 * It must display reviewedStateDigest and require the user to choose the named gate.
 * Body actor/timestamps/snapshots are never accepted. Each invocation confirms ONE gate.
 */
export async function confirmCharacterPromoGate(
  input:ReviewActionInput & {gate:ContentGate},
  deps:ReviewActionDependencies,
) {
  if(!CONTENT_GATES.includes(input.gate))throw new PromoReviewError('confirmation_input_invalid','Explicit named confirmation required')
  const {user,model,state}=await currentReview(input,deps)
  if(model.blockers.length || model.nextGate!==input.gate || !state.generationId)throw new PromoReviewError('confirmation_review_changed','This gate is not eligible; refresh and explicitly review again')
  let result
  try {result=await deps.db.rpc('cs_confirm_character_promo_gate',{p_plan_id:input.planId,p_content:model.content,p_digest:model.contentDigest,p_expected:model.expected,p_gate:input.gate,p_actor:user.id})} catch {throw new PromoReviewError('confirmation_outcome_unknown','Confirmation outcome is unknown; refresh evidence before any retry')}
  const saved=result.data
  if(result.error || !evidenceShape(saved) || saved.invalidated || saved.generationId!==state.generationId || saved.gate!==input.gate || saved.confirmedBy!==user.id || saved.contentDigest!==model.contentDigest || promoReviewDigest(saved.content)!==model.contentDigest || Date.parse(saved.confirmedAt)>deps.now() || Date.parse(saved.confirmedAt)<Math.max(-Infinity,...state.gates.map(row=>Date.parse(row.confirmedAt))))throw new PromoReviewError('confirmation_outcome_unknown','Confirmation persistence is unverified; refresh evidence before any retry')
  return {gate:input.gate,evidence:saved,deliveryApproved:false as const,scheduled:false as const,published:false as const}
}
