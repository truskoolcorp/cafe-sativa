import 'server-only'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v)
/** No-argument, one-shot successor transition. The owner-provisioned SQL scope
 * alone selects the original occurrence and requires both real publication
 * receipts. It cannot synthesize, reset claims, renew quotes or create approval.
 * No route/cron/live grant is installed by this source. */
export function createCafeSuccessorOperation(){
 const enabled=()=>process.env.CS_CHARACTER_SUCCESSOR_ENABLED==='true'
 let used=false,closing=false,work:Promise<unknown>|undefined,network:ReturnType<typeof createProductionFetch>|undefined
 return {async run(parent:AbortSignal){
  if(used||closing||parent.aborted||!enabled())return {status:'disabled' as const}
  used=true
  const signal=AbortSignal.any([parent,AbortSignal.timeout(15000)])
  const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Successor disabled')}
  work=(async()=>{
   network=createProductionFetch(signal,(input,init)=>{check();init?.signal?.throwIfAborted();return fetch(input,init)})
   const db=createAdminClient(network.fetch)
   check()
   const result=await db.rpc('character_production_successor_context',{}).abortSignal(signal).retry(false)
   check()
   // Unknown transition results are never repeated within this operation. A
   // later finite call reads the retained edge/current binding, not a replay.
   if(result.error)return {status:'held_successor_outcome' as const}
   if(result.data===null)return {status:'held_successor' as const}
   const r=result.data as {status?:unknown;priorOccurrenceId?:unknown;occurrenceId?:unknown;context?:unknown}
   if(r.status==='current_occurrence')return {status:'current_occurrence' as const}
   if(r.status!=='successor_prepared'||!uuid(r.priorOccurrenceId)||!uuid(r.occurrenceId)||r.priorOccurrenceId===r.occurrenceId)throw Error('Invalid successor receipt')
   return {status:'successor_prepared' as const,priorOccurrenceId:r.priorOccurrenceId,occurrenceId:r.occurrenceId,generated:false as const,published:false as const}
  })()
  return await work
 },async whenSettled(){
  closing=true
  const settled=await Promise.allSettled(work?[work]:[])
  await network?.whenSettled()
  if(settled.some(x=>x.status==='rejected'))throw Error('Successor settled with failure')
 }}
}
