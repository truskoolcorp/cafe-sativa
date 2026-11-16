import 'server-only'
import {createCafeFirstDeliveryOperation} from './character-promo-cafe-first-delivery-server'
import {cafeEditorialFromPlan} from './character-promo-cafe-editorial-from-plan'
import {createCafeSourceReader} from './character-promo-cafe-sources-server'
import {createCafeStandingServer,type CafeStandingServerConfig} from './character-promo-cafe-standing-server'
import {cafeScheduleDigest} from './character-promo-cafe-metricool'
import {validateCafeApprovalCandidate} from './character-promo-cafe-approval'
/** Trusted enrolled-QA caller only, not an HTTP/preview approval route. Each
 * destination still passes current source/media/semantic and stored owner checks.
 * Never dispatches posts; absent separately authorized semantic lease is held. */
export function createCafeInitialStandingOperation(draftId:string,input:Omit<CafeStandingServerConfig,'metadata'>){
 const config={signal:input.signal,capability:input.capability,semanticLease:input.semanticLease?structuredClone(input.semanticLease):null,verifiedCollaborators:structuredClone(input.verifiedCollaborators)}
 let used=false,work:Promise<unknown>|null=null
 const enabled=()=>process.env.CS_CAFE_FIRST_DELIVERY_ENABLED==='true'&&process.env.CS_CAFE_INITIAL_STANDING_ENABLED==='true'
 return {run(){
  if(used||!enabled()||!config.capability||!config.semanticLease||config.semanticLease.countingAuthorized!==true||config.semanticLease.expiresAt<=Date.now())return Promise.resolve({status:'held' as const})
  used=true
  const signal=AbortSignal.any([config.signal,AbortSignal.timeout(55000)])
  const preparation=createCafeFirstDeliveryOperation(draftId,config.capability)
  let source:ReturnType<typeof createCafeSourceReader>|undefined
  const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Initial standing held')}
  const promise=(async()=>{try{
   check();const prepared=await preparation.run(signal);check()
   if(prepared.status!=='plans_prepared')return {status:'held' as const}
   const metadata=new Map<string,ReturnType<typeof cafeEditorialFromPlan>>()
   for(const raw of prepared.editorial){
    const r=raw as {planId:string;plan:Record<string,unknown>;draft:Record<string,unknown>}
    if(!r.plan||!r.draft||r.planId!==r.plan.id||r.draft.id!==draftId)throw Error('Exact persisted pair required')
    metadata.set(r.planId,cafeEditorialFromPlan(r.plan,r.draft,raw))
   }
   if(metadata.size!==2)throw Error('Exact pair required')
   source=createCafeSourceReader({signal,metadata,verifiedCollaborators:config.verifiedCollaborators})
   const results=[]
   for(const planId of [prepared.receipt.facebookPlanId,prepared.receipt.instagramPlanId]){
    check();const candidate=await source.load(planId);check();validateCafeApprovalCandidate(candidate,Date.now())
    if(candidate.schedule.planId!==planId)throw Error('Current plan mismatch')
    const expectedDigest=cafeScheduleDigest(candidate.schedule)
    const standing=createCafeStandingServer({...config,signal,metadata})
    const result=await standing.record({planId,expectedDigest},{enabled:true});check()
    results.push({planId,result})
    if(result.status!=='recorded')return {status:'held' as const,results,published:false as const}
   }
   return {status:'authority_recorded' as const,results,published:false as const}
  }finally{await preparation.whenSettled();if(source)await source.whenSettled()}})()
  work=promise;return promise
 },async whenSettled(){used=true;await work}}
}
