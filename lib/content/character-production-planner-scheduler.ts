import type {PlannerInput} from './character-production-planner.ts'
type Result={status:'disabled'|'idle'|'blocked'|'held'}|{status:'planned';key:string;digest:string;draftId:string;replayed:boolean}
export interface PlannerSchedulerDependencies {
 /** Trusted internal candidate store only. No HTTP body/query or caller slots. */
 readCandidate(signal:AbortSignal):Promise<PlannerInput|null>;
 planner:{plan(input:PlannerInput,signal:AbortSignal):Promise<Result>};
}
/** One read and at most one planning call per invocation, no retries or provider
 * calls. A timeout after starting planning is ambiguous and must be reconciled.
 * No route/cron registration here. Cross-invocation dedupe remains SQL-owned.
 */
export function createPlannerScheduler(config:Readonly<{enabled:boolean;deadlineMs?:number}>,open:()=>PlannerSchedulerDependencies){
 const enabled=config.enabled===true,ms=config.deadlineMs??10000
 if(!Number.isSafeInteger(ms)||ms<1||ms>30000)throw Error('Invalid scheduler deadline')
 return {async tick(outer:AbortSignal):Promise<Result>{
  if(!enabled)return {status:'disabled'}
  if(outer.aborted)return {status:'blocked'}
  const controller=new AbortController();let writing=false,timer:ReturnType<typeof setTimeout>|undefined,settle:(r:Result)=>void=()=>{}
  const stop=()=>{controller.abort();settle({status:writing?'held':'blocked'})}
  outer.addEventListener('abort',stop,{once:true})
  try{return await Promise.race([(async():Promise<Result>=>{
   const d=open(),candidate=await d.readCandidate(controller.signal)
   if(controller.signal.aborted||outer.aborted)return {status:'blocked'}
   if(!candidate)return {status:'idle'}
   writing=true
   const result=await d.planner.plan(candidate,controller.signal)
   if(controller.signal.aborted||outer.aborted)return {status:'held'}
   return result
  })(),new Promise<Result>(resolve=>{settle=resolve;timer=setTimeout(stop,ms);if(outer.aborted)stop()})])}catch{return {status:writing?'held':'blocked'}}finally{clearTimeout(timer);outer.removeEventListener('abort',stop);controller.abort()}
 }}
}
