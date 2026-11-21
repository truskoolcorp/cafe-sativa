import {probeTextReceipt,probeTextCheckpoint} from './character-production-text-receipt-probe'
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
export function createReplenishmentOperation(config:{scope:ReplenishmentSourceScope;lease:ReplenishmentLease;deadlineMs:number;expectedKey?:string;current?:()=>Promise<void>}){
 const scope=structuredClone(config.scope),lease=structuredClone(config.lease),deadline=config.deadlineMs,current=config.current,expectedKey=config.expectedKey
 if(!Number.isSafeInteger(deadline)||deadline<1000||deadline>85000||!scope.characterId)throw Error('Invalid finite replenishment scope')
 let consumed=false,closing=false,work:Promise<unknown>|undefined
 let providerNetwork:ReturnType<typeof createProductionFetch>|undefined
 let network:ReturnType<typeof createProductionFetch>|undefined,sources:ReturnType<typeof openReplenishmentSources>|undefined
 const enabled=()=>process.env.CS_CHARACTER_TEXT_REPLENISHMENT_ENABLED==='true'&&process.env.CS_CHARACTER_TEXT_RECEIPT_EVIDENCE_ENABLED==='true'&&process.env.CS_CHARACTER_TEXT_CHECKPOINT_ENABLED==='true'
 return {
  async run(parent:AbortSignal){
   if(consumed||closing||parent.aborted||!enabled())return {status:'disabled' as const}
   consumed=true
   const deadlineAt=Date.now()+deadline
   const signal=AbortSignal.any([parent,AbortSignal.timeout(deadline)])
   work=(async()=>{
    signal.throwIfAborted();await current?.();network=createProductionFetch(signal);const db=createAdminClient(network.fetch)
    sources=openReplenishmentSources(scope,signal)
    const store=createReplenishmentStore({async rpc(name,args){
     signal.throwIfAborted();if(!enabled()||!names.has(name))throw Error('Text capability unavailable')
     await current?.();const result=await db.rpc(name,structuredClone(args)).abortSignal(signal).retry(false)
     signal.throwIfAborted();return result
    }})
    const complete=createReplenishmentCompletion(guard=>{
     providerNetwork=createProductionFetch(signal,async(input,init)=>{await current?.();init?.signal?.throwIfAborted();if(!enabled()||deadlineAt-Date.now()<25000)throw Error('Text dispatch deadline or capability unavailable');guard();return fetch(input,init)})
     return providerNetwork.fetch
    })
    // Negative probe exercises the exact installed receipt signature/permission.
    // Reviewed SQL rejects all-null metadata before any mutation. Missing RPC,
    // missing grant, transport error or unexpected result holds before claim.
    const receipt={
     async checkpoint(identity:{key:string;token:string;sourceDigest:string},e:import('./character-production-text-receipt-evidence').TextReceiptEvidence,contentJson:string,s:AbortSignal){
      s.throwIfAborted();if(!enabled())return false
      const r=await db.rpc('character_production_text_checkpoint',{p_key:identity.key,p_token:identity.token,p_digest:identity.sourceDigest,p_provider_id:e.providerId,p_request_id:e.requestId,p_model:e.model,p_stop_reason:e.stopReason,p_input_tokens:e.inputTokens,p_output_tokens:e.outputTokens,p_response_sha256:e.responseSha256,p_content_json:contentJson}).abortSignal(s).retry(false)
      s.throwIfAborted();return !r.error&&r.data===true
     },
     async ready(s:AbortSignal){
      s.throwIfAborted();if(!enabled())return false
      const ready=await probeTextReceipt(args=>db.rpc('character_production_text_receipt',args).abortSignal(s).retry(false))
      s.throwIfAborted();return enabled()&&ready&&await probeTextCheckpoint(args=>db.rpc('character_production_text_checkpoint',args).abortSignal(s).retry(false))
     },
     async persist(identity:{key:string;token:string;sourceDigest:string},e:import('./character-production-text-receipt-evidence').TextReceiptEvidence,s:AbortSignal){
      s.throwIfAborted();if(!enabled())return false
      // Evidence is not authority: no fresh lease/source lookup after dispatch.
      // Original deadline and tracked transport still apply, never detached.
      const r=await db.rpc('character_production_text_receipt',{p_key:identity.key,p_token:identity.token,p_digest:identity.sourceDigest,p_provider_id:e.providerId,p_request_id:e.requestId,p_model:e.model,p_stop_reason:e.stopReason,p_input_tokens:e.inputTokens,p_output_tokens:e.outputTokens,p_response_sha256:e.responseSha256}).abortSignal(s).retry(false)
      s.throwIfAborted();return !r.error&&r.data===true
     },
    }
    const operation=createFreshCandidateReplenisher({enabled,now:Date.now,load:()=>sources!.load(),store,complete,receipt})
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Date.now())
    const part=(type:string)=>parts.find(p=>p.type===type)!.value
    const key=`daily:${part('year')}-${part('month')}-${part('day')}:${scope.characterId}`
    if(expectedKey!==undefined&&key!==expectedKey)throw Error('Original preparation day changed');
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

