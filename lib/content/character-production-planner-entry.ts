import type {ProductionServerRpcClient} from './character-production-server-rpc.ts'
import type {TrustedPlannerManifest} from './character-production-planner-trusted-composition.ts'
import {createScopedPlannerAdapter} from './character-production-planner-scoped-adapter.ts'
export type PlannerEntryResult={status:'disabled'|'unauthorized'|'idle'|'blocked'|'held'}|{status:'planned';key:string;digest:string;draftId:string;replayed:boolean}
export type ReviewedPlannerEnrollment=Readonly<{id:string;manifestSha256:string;ordinals:readonly number[];manifest:TrustedPlannerManifest}>
export interface PlannerEntryDependencies {
 enabled():boolean;
 authorize(header:string|null):boolean;
 /** Reviewed scoped SQL capability only; no storage-client fallback. */
 open(signal:AbortSignal):ProductionServerRpcClient|null;
 create(manifest:TrustedPlannerManifest,resolveActor:(signal:AbortSignal)=>Promise<string|null>,openClient:(signal:AbortSignal)=>ProductionServerRpcClient|null):{tick(signal:AbortSignal):Promise<PlannerEntryResult>};
}
/** Dormant internal entry. No HTTP body/query, caller identity or candidates accepted.
 * One bounded lifetime includes context bootstrap and planner invocation. */
export function createPlannerEntry(enrollment:ReviewedPlannerEnrollment,deps:PlannerEntryDependencies){
 const reviewed=structuredClone(enrollment),ms=reviewed.manifest.deadlineMs
 if(!Number.isSafeInteger(ms)||ms<1||ms>30000||reviewed.ordinals.length!==reviewed.manifest.candidates.length||!reviewed.ordinals.length)throw Error('Invalid reviewed scheduler configuration')
 return {async run(header:string|null,outer:AbortSignal):Promise<PlannerEntryResult>{
  if(reviewed.manifest.enabled!==true||deps.enabled()!==true)return {status:'disabled'}
  if(!deps.authorize(header))return {status:'unauthorized'}
  if(outer.aborted)return {status:'blocked'}
  const life=new AbortController();let started=false,timer:ReturnType<typeof setTimeout>|undefined,settle:(r:PlannerEntryResult)=>void=()=>{}
  const stop=()=>{life.abort();settle({status:started?'held':'blocked'})}
  outer.addEventListener('abort',stop,{once:true})
  try{return await Promise.race([(async():Promise<PlannerEntryResult>=>{
   const db=deps.open(life.signal);if(!db)return {status:'blocked'}
   const bootstrap=await db.rpc('character_production_scheduler_context',{p_enrollment:reviewed.id}).abortSignal(life.signal).retry(false)
   if(life.signal.aborted||bootstrap.error)return {status:'blocked'}
   const context=bootstrap.data as {actorId?:unknown}|null
   if(!context||typeof context.actorId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(context.actorId))return {status:'blocked'}
   const actor=context.actorId,adapter=createScopedPlannerAdapter(db,reviewed.id,reviewed.manifestSha256,reviewed.manifest.candidates.map((input,i)=>({ordinal:reviewed.ordinals[i],input:{...input,actorId:actor}})))
   // Establish complete immutable context binding before media/provider sources open.
   const policy=await adapter.rpc('character_production_planning_policy',{p_id:reviewed.manifest.candidates[0].policyId}).abortSignal(life.signal).retry(false)
   if(life.signal.aborted||policy.error||!policy.data)return {status:'blocked'}
   const runner=deps.create(reviewed.manifest,async signal=>signal.aborted?null:actor,signal=>signal.aborted?null:adapter)
   if(life.signal.aborted)return {status:'blocked'}
   started=true
   const result=await runner.tick(life.signal)
   return life.signal.aborted?{status:'held'}:result
  })(),new Promise<PlannerEntryResult>(resolve=>{settle=resolve;timer=setTimeout(stop,ms);if(outer.aborted)stop()})])}catch{return {status:started?'held':'blocked'}}finally{clearTimeout(timer);life.abort();outer.removeEventListener('abort',stop)}
 }}
}
