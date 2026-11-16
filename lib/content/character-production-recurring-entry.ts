import {createProductionTimeBudget,type ProductionTimeBudget} from './character-production-time-budget.ts'
/** Dormant scheduling boundary. Trusted composition adapts existing planner,
 * original-task collector, private QA, standing-authority and Café dispatch /
 * receipt handlers. No route, credentials, cadence, enrollment or provider is
 * created here. One stage per tick prevents copying/inference starving original
 * paid-task receipt persistence. SQL claims, not this process gate, fence replay. */
export const cafeRecurringPhases=['collect','reconcile','plan','generate','qa','authority','dispatch'] as const
export type CafeRecurringPhase=typeof cafeRecurringPhases[number]
export type CafeRecurringSession={
 /** Trusted durable selector must prioritize unfinished original tasks/receipts.
  * Never derive identities, authority or a candidate from HTTP input. */
 next(signal:AbortSignal):Promise<CafeRecurringPhase|null>
 /** Each adapter retains its existing exact enrollment, budget, QA, duplicate
  * and receipt checks. Missing adapters hold, never fall back to legacy routes. */
 stages:Partial<Record<CafeRecurringPhase,(signal:AbortSignal)=>Promise<void>>>
 /** Resolves only after ALL original operations settle, including unknown writes. */
 whenSettled():Promise<void>
}
export function createCafeRecurringEntry(d:{
 enabled?:()=>boolean;authorize:(header:string|null)=>boolean;
 open:(signal:AbortSignal,budget:ProductionTimeBudget)=>CafeRecurringSession;timeoutMs?:number;
}){
 const timeout=d.timeoutMs??45000
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>45000)throw Error('Invalid recurring tick deadline')
 let busy=false
 const reply=(code:number,status:string,phase?:CafeRecurringPhase)=>Response.json({status,...(phase?{phase}:{}),publicationVerified:false},{status:code,headers:{'Cache-Control':'private, no-store'}})
 return async(req:Request):Promise<Response>=>{
  if(req.method!=='GET'||new URL(req.url).search||req.body!==null)return reply(405,'unsupported')
  if(!d.authorize(req.headers.get('authorization')))return reply(401,'unauthorized')
  if(d.enabled?.()!==true)return reply(503,'disabled')
  if(req.signal.aborted)return reply(503,'held')
  if(busy)return reply(429,'busy')
  busy=true
  const life=new AbortController(),abort=()=>life.abort()
  req.signal.addEventListener('abort',abort,{once:true});if(req.signal.aborted)abort()
  let timer:ReturnType<typeof setTimeout>|undefined,session:CafeRecurringSession|undefined
  const task=(async()=>{
   try{
    life.signal.throwIfAborted();session=d.open(life.signal,createProductionTimeBudget(life.signal,timeout))
    const phase=await session.next(life.signal)
    life.signal.throwIfAborted()
    if(phase===null)return reply(200,'idle')
    if(!cafeRecurringPhases.includes(phase))return reply(503,'held')
    const run=session.stages[phase]
    if(typeof run!=='function'||d.enabled?.()!==true)return reply(503,'held',phase)
    life.signal.throwIfAborted()
    await run(life.signal)
    life.signal.throwIfAborted()
    // Adapter settlement is NOT a provider receipt or end-to-end success.
    return reply(200,'stage_settled',phase)
   }catch{return reply(503,'held')}
  })()
  // Failure to establish settlement leaves the process held permanently rather
  // than inviting another uncertain write. Durable adapter claims span instances.
  void task.then(async()=>{try{await session?.whenSettled();busy=false}catch{/* remain held */}})
  let onAbort:()=>void=()=>{}
  const cancelled=new Promise<Response>(resolve=>{onAbort=()=>resolve(reply(503,'held'));life.signal.addEventListener('abort',onAbort,{once:true});if(life.signal.aborted)onAbort();timer=setTimeout(abort,timeout)})
  try{return await Promise.race([task,cancelled])}
  finally{clearTimeout(timer);life.abort();life.signal.removeEventListener('abort',onAbort);req.signal.removeEventListener('abort',abort)}
 }
}

