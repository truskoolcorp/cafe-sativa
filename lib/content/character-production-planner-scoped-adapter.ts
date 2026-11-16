import {isDeepStrictEqual} from 'node:util'
import type {ProductionServerRpcClient} from './character-production-server-rpc.ts'
import type {PlannerInput} from './character-production-planner.ts'
import {productionSlotDigest} from './character-production-engine.ts'
type Candidate=Readonly<{ordinal:number;input:PlannerInput}>
/** Reviewed immutable enrollment only, never request data. This adapter is not
 * authentication. SQL scoped wrappers resolve the enrolled actor on every call.
 * The application must authenticate cron before constructing this dormant adapter.
 */
export function createScopedPlannerAdapter(db:ProductionServerRpcClient,enrollment:string,manifestSha256:string,records:readonly Candidate[]):ProductionServerRpcClient{
 if(!/^[a-f0-9-]{36}$/.test(enrollment)||!/^[a-f0-9]{64}$/.test(manifestSha256)||records.length>32)throw Error('Invalid scoped enrollment')
 const candidates=structuredClone(records)
 if(new Set(candidates.map(c=>c.ordinal)).size!==candidates.length||candidates.some(c=>!Number.isInteger(c.ordinal)||c.ordinal<0||c.ordinal>31))throw Error('Invalid candidate ordinal')
 return {rpc(name,args){return {abortSignal(signal){return {async retry(enabled:false){
  if(enabled!==false||signal.aborted)throw Error('Scoped planner cancelled or retry rejected')
  if(name==='character_production_planning_policy'){
   if(Object.keys(args).join()!=='p_id'||!candidates.some(c=>c.input.policyId===args.p_id))throw Error('Policy scope rejected')
   const result=await db.rpc('character_production_scheduler_context',{p_enrollment:enrollment}).abortSignal(signal).retry(false)
   if(signal.aborted||result.error)return {data:null,error:result.error??'cancelled'}
   const context=result.data as Record<string,unknown>|null
   if(!context||context.enrollmentId!==enrollment||context.manifestSha256!==manifestSha256||!candidates.every(c=>c.input.actorId===context.actorId))return {data:null,error:'Enrollment mismatch'}
   const expected=candidates.map(c=>({ordinal:c.ordinal,slot:c.input.slot,digest:productionSlotDigest(c.input.slot),draftId:c.input.draftId,theme:c.input.theme,scheduledAt:c.input.scheduledAt})).sort((a,b)=>a.ordinal-b.ordinal)
   const projection=context.policy as {policy?:{id?:unknown;revision?:unknown}}|null
   if(!isDeepStrictEqual(context.candidates,expected)||!candidates.every(c=>projection?.policy?.id===c.input.policyId&&projection?.policy?.revision===c.input.policyRevision))return {data:null,error:'Stored candidate or policy mismatch'}
   // Policy freshness/shape/revision is checked by the existing policy reader.
   return {data:context.policy,error:null}
  }
  const candidate=candidates.find(c=>name==='character_production_planned_draft'
   ?isDeepStrictEqual(args,{p_id:c.input.draftId,p_slot:c.input.slot,p_digest:productionSlotDigest(c.input.slot),p_theme:c.input.theme})
   :name==='character_production_plan'&&isDeepStrictEqual({...args,p_plan:undefined},{p_slot:c.input.slot,p_digest:productionSlotDigest(c.input.slot),p_policy_id:c.input.policyId,p_policy_revision:c.input.policyRevision,p_actor:c.input.actorId,p_plan:undefined})&&!!args.p_plan&&isDeepStrictEqual({...args.p_plan as object,validation:undefined},{version:1,draftId:c.input.draftId,scheduledAt:c.input.scheduledAt,theme:c.input.theme,validation:undefined}))
  if(!candidate)throw Error('Candidate scope rejected')
  const target=name==='character_production_plan'?'character_production_scheduler_plan':'character_production_scheduler_reconciled'
  return db.rpc(target,{p_enrollment:enrollment,p_ordinal:candidate.ordinal,...(target==='character_production_scheduler_plan'?{p_validation:(args.p_plan as Record<string,unknown>).validation}:{})}).abortSignal(signal).retry(false)
 }}}}}}
}
