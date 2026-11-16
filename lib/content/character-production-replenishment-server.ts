import 'server-only'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {openReplenishmentSources} from './character-production-replenishment-sources-server'
import type {ReplenishmentSourceScope} from './character-production-replenishment-sources'
import {createFreshCandidateReplenisher,type ReplenishmentLease} from './character-production-replenishment'
import {createReplenishmentCompletion} from './character-production-replenishment-provider'
import {createReplenishmentStore} from './character-production-replenishment-store'
const names=new Set(['character_production_text_claim','character_production_text_authorized','character_production_text_save'])
/** Dormant code-owned operation, NOT a route or standing authorization. Existing
 * service_role credential requires separate approval for these three grants,
 * including Storage admin's indirect SET ROLE path. No owner/admin fallback RPC.
 * Explicit lease is separate from HeyGen; no lease provisioning or renewals. */
export function createReplenishmentOperation(config:{scope:ReplenishmentSourceScope;lease:ReplenishmentLease;deadlineMs:number}){
 const scope=structuredClone(config.scope),lease=structuredClone(config.lease),deadline=config.deadlineMs
 if(!Number.isSafeInteger(deadline)||deadline<1000||deadline>85000||!scope.characterId)throw Error('Invalid finite replenishment scope')
 let consumed=false,closing=false,work:Promise<unknown>|undefined
 let providerNetwork:ReturnType<typeof createProductionFetch>|undefined
 let network:ReturnType<typeof createProductionFetch>|undefined,sources:ReturnType<typeof openReplenishmentSources>|undefined
 const enabled=()=>process.env.CS_CHARACTER_TEXT_REPLENISHMENT_ENABLED==='true'
 return {
  async run(parent:AbortSignal){
   if(consumed||closing||parent.aborted||!enabled())return {status:'disabled' as const}
   consumed=true
   const signal=AbortSignal.any([parent,AbortSignal.timeout(deadline)])
   work=(async()=>{
    signal.throwIfAborted();network=createProductionFetch(signal);const db=createAdminClient(network.fetch)
    sources=openReplenishmentSources(scope,signal)
    const store=createReplenishmentStore({async rpc(name,args){
     signal.throwIfAborted();if(!enabled()||!names.has(name))throw Error('Text capability unavailable')
     const result=await db.rpc(name,structuredClone(args)).abortSignal(signal).retry(false)
     signal.throwIfAborted();return result
    }})
    const complete=createReplenishmentCompletion(guard=>{
     providerNetwork=createProductionFetch(signal,(input,init)=>{init?.signal?.throwIfAborted();guard();return fetch(input,init)})
     return providerNetwork.fetch
    })
    const operation=createFreshCandidateReplenisher({enabled,now:Date.now,load:()=>sources!.load(),store,complete})
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Date.now())
    const part=(type:string)=>parts.find(p=>p.type===type)!.value
    const key=`daily:${part('year')}-${part('month')}-${part('day')}:${scope.characterId}`
    return operation.produce(key,lease,signal)
   })()
   return await work
  },
  async whenSettled(){
   closing=true
   // Join original operation before draining both network trackers. A source
   // read may start another transport while awaiting GLYPH; no early release.
   const original=await Promise.allSettled(work?[work]:[])
   const drained=await Promise.allSettled([sources?.whenSettled(),network?.whenSettled(),providerNetwork?.whenSettled()])
   if([...original,...drained].some(r=>r.status==='rejected'))throw Error('Replenishment settled with failure')
  },
 }
}
