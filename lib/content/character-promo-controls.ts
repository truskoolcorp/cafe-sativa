/** Pure dormant adapter. Runtime supplies a freshly verified actor; no provider calls. */
export type PromoControlsRPC = (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
type Obj=Record<string,any>
export type PromoControlAction='withdraw'|'restore'
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const obj=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v)
const keys=(v:unknown,names:string):v is Obj=>obj(v)&&Object.keys(v).sort().join(',')===names.split(',').sort().join(',')
const text=(v:unknown):v is string=>typeof v==='string'
const date=(v:unknown)=>text(v)&&Number.isFinite(Date.parse(v))
const integer=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0
const nullableText=(v:unknown)=>v===null||text(v)
const state=(v:unknown)=>v===null||['submitting','submission_unknown','scheduled'].includes(v as string)
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v))
const effects={withdraw:'Stop this unattempted plan; other independently approved active plans may become eligible. No provider cancellation or dispatch.',restore:'Restore this plan to the required cohort; prior consent remains invalid and a new explicit review is required. No dispatch.'}
function demand(ok:unknown,message='Plan control result unconfirmed; refresh before retrying'):asserts ok {if(!ok)throw Error(message)}
function action(v:unknown):v is PromoControlAction{return v==='withdraw'||v==='restore'}
function cohort(v:unknown):v is Obj[]{
 if(!Array.isArray(v)||!v.length)return false
 const ids=new Set<string>()
 return v.every(x=>keys(x,'planId,network,accountId,caption,scheduledAt,withdrawn,controlRevision,attemptState')&&uuid(x.planId)&&!ids.has(x.planId)&&!!ids.add(x.planId)&&text(x.network)&&nullableText(x.accountId)&&nullableText(x.caption)&&date(x.scheduledAt)&&typeof x.withdrawn==='boolean'&&integer(x.controlRevision)&&state(x.attemptState)&&!(x.withdrawn&&x.attemptState!==null))
}
function snapshot(v:unknown,actor:string):v is Obj{
 if(!keys(v,'version,reviewId,actor,actorEpoch,planId,action,expectedCohort,effect')||v.version!==1||!uuid(v.reviewId)||v.actor!==actor||!integer(v.actorEpoch)||!uuid(v.planId)||!action(v.action)||v.effect!==effects[v.action]||!Array.isArray(v.expectedCohort)||!v.expectedCohort.length)return false
 const ids=new Set<string>(),promos=new Set<string>()
 for(const row of v.expectedCohort){
  if(!keys(row,'plan,withdrawn,controlRevision')||typeof row.withdrawn!=='boolean'||!integer(row.controlRevision)||!keys(row.plan,'id,promo_id,character_id,network,account_id,caption,scheduled_at,status'))return false
  const p=row.plan
  if(!uuid(p.id)||!uuid(p.promo_id)||ids.has(p.id)||!text(p.character_id)||!text(p.network)||!nullableText(p.account_id)||!nullableText(p.caption)||!date(p.scheduled_at)||!text(p.status))return false
  ids.add(p.id);promos.add(p.promo_id)
 }
 const target=v.expectedCohort.find((r:Obj)=>r.plan.id===v.planId)
 return promos.size===1&&!!target&&target.withdrawn===(v.action==='restore')
}
function blocked(v:unknown,planId:string,a:PromoControlAction):v is Obj{
 return keys(v,'status,planId,providerCancelled')&&v.planId===planId&&v.providerCancelled===false&&(v.status==='reconciliation_required'||(a==='restore'&&v.status==='shared_dispatch_started'))
}
function receipt(v:unknown,reviewId:string,review?:Obj):v is Obj{
 if(!keys(v,'reviewId,planId,action,withdrawn,confirmedAt,providerCancelled,dispatched,consentInvalidated,reviewRequired,generationStarted,cohort')||v.reviewId!==reviewId||!uuid(v.planId)||!action(v.action)||v.withdrawn!==(v.action==='withdraw')||!date(v.confirmedAt)||v.providerCancelled!==false||v.dispatched!==false||v.consentInvalidated!==true||v.reviewRequired!==true||v.generationStarted!==false||!cohort(v.cohort))return false
 const target=v.cohort.find((x:Obj)=>x.planId===v.planId)
 if(!target||target.withdrawn!==v.withdrawn||target.attemptState!==null)return false
 if(!review)return true
 if(v.planId!==review.planId||v.action!==review.action||v.cohort.length!==review.expectedCohort.length)return false
 return review.expectedCohort.every((r:Obj)=>{
  const x=v.cohort.find((y:Obj)=>y.planId===r.plan.id)
  return x&&x.network===r.plan.network&&x.accountId===r.plan.account_id&&x.caption===r.plan.caption&&x.scheduledAt===r.plan.scheduled_at&&x.withdrawn===(x.planId===v.planId?v.withdrawn:r.withdrawn)&&x.controlRevision===r.controlRevision+(x.planId===v.planId?1:0)
 })
}
export function createCharacterPromoControls(rpc:PromoControlsRPC,actor:string){
 demand(uuid(actor),'Verified owner identity required')
 async function call(name:string,args:Record<string,unknown>){
  try {const r=await rpc(name,args);demand(r&&!r.error);return r.data}catch{throw Error('Plan control result unconfirmed; refresh before retrying')}
 }
 return {
  async read(planId:string){
   demand(uuid(planId),'Invalid plan control request')
   const r=await call('cs_read_character_promo_plan_controls',{p_plan_id:planId})
   demand(keys(r,'planId,withdrawn,targetAttemptState,hasSharedAttempt,cohort')&&r.planId===planId&&typeof r.withdrawn==='boolean'&&state(r.targetAttemptState)&&typeof r.hasSharedAttempt==='boolean'&&cohort(r.cohort))
   const target=r.cohort.find((x:Obj)=>x.planId===planId)
   demand(target&&target.withdrawn===r.withdrawn&&target.attemptState===r.targetAttemptState&&r.hasSharedAttempt===r.cohort.some((x:Obj)=>x.attemptState!==null))
   return copy(r)
  },
  async review(body:unknown){
   demand(keys(body,'planId,action')&&uuid(body.planId)&&action(body.action),'Invalid plan control request')
   const id=body.planId,a=body.action
   const r=await call('cs_review_character_promo_plan_control',{p_plan_id:id,p_action:a,p_actor:actor})
   if(blocked(r,id,a))return copy(r)
   demand(keys(r,'snapshot,digest')&&digest(r.digest)&&snapshot(r.snapshot,actor)&&r.snapshot.planId===id&&r.snapshot.action===a)
   return copy(r)
  },
  async save(body:unknown){
   demand(keys(body,'snapshot,digest')&&digest(body.digest)&&snapshot(body.snapshot,actor),'Exact reviewed plan control required')
   const review=copy(body.snapshot),hash=body.digest
   const r=await call('cs_save_character_promo_plan_control',{p_snapshot:review,p_digest:hash,p_actor:actor})
   // Save is successful ONLY with a durable matching receipt. Blockers stay unresolved.
   demand(!blocked(r,review.planId,review.action))
   demand(receipt(r,review.reviewId,review))
   return copy(r)
  },
  async reconcile(body:unknown){
   demand(keys(body,'reviewId')&&uuid(body.reviewId),'Invalid plan control request')
   const id=body.reviewId
   const r=await call('cs_read_character_promo_plan_control_result',{p_review_id:id,p_actor:actor})
   // Null remains unknown, not proof of failure or an HTTP-success receipt.
   // Never retry or dispatch here.
   demand(r!==null)
   demand(receipt(r,id))
   return copy(r)
  },
 }
}
