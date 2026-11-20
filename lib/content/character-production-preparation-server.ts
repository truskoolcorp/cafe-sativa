import {probeTextReceipt,probeTextCheckpoint} from './character-production-text-receipt-probe'
import 'server-only'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createReplenishmentOperation} from './character-production-replenishment-server'
import {createFreshSpeechOperation,createFiniteNov17SpeechOperation} from './character-production-fresh-speech-server'
import {createFreshSpeechReceiptReader,type PersistedFreshTextIdentity} from './character-production-fresh-speech-receipt-store'
import type {ReplenishmentLease} from './character-production-replenishment'
import type {ReplenishmentSourceScope} from './character-production-replenishment-sources'
type Context={occurrenceId:string;textKey:string;textStarted:boolean;speechStarted:boolean;textState:string|null;identity:PersistedFreshTextIdentity|null;active:boolean;sourceScope:ReplenishmentSourceScope|null;lease:ReplenishmentLease|null}
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now())
/** One trusted finite phase per invocation. No caller keys/scopes, no successor,
 * reset/retry, route or activation. Saved original identity survives day/lease
 * expiry; only read-only receipt recovery is allowed then. */
export function createCafePreparationOperation(allowed:()=>boolean=()=>true){return createPreparationOperation(allowed,false)}
/** Additive, one-use text recovery authority. Never resets the original phase.
 * A saved identity must continue through the original speech operation instead. */
export function createCafePrivateTextRecoveryOperation(allowed:()=>boolean){return createPreparationOperation(allowed,true)}
export function createCafeFiniteNov17TestOperation(allowed:()=>boolean){return createPreparationOperation(allowed,false,true)}
function createPreparationOperation(allowed:()=>boolean,recovery:boolean,finite=false){
 const enabled=()=>allowed()&&(finite?(process.env.CS_CHARACTER_FINITE_NOV17_TEST_ENABLED==='true'&&Date.now()>=Date.parse('2026-11-17T06:00:00Z')&&Date.now()<Date.parse('2026-11-18T06:00:00Z')):process.env.CS_CHARACTER_PREPARATION_ENABLED==='true')&&(!recovery||process.env.CS_CHARACTER_PRIVATE_TEXT_RECOVERY_ENABLED==='true')
 let used=false,closing=false,work:Promise<unknown>|undefined,network:ReturnType<typeof createProductionFetch>|undefined
 let child:{whenSettled():Promise<void>}|undefined
 return {async run(parent:AbortSignal){
  if(used||closing||parent.aborted||!enabled())return {status:'disabled' as const}
  used=true;const signal=AbortSignal.any([parent,AbortSignal.timeout(85000)]),check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Preparation disabled')}
  work=(async()=>{
   check();network=createProductionFetch(signal);const db=createAdminClient(network.fetch)
   const read=async():Promise<Context|null>=>{check();const r=await db.rpc(finite?'character_production_finite_test_context':recovery?'character_production_private_recovery_context':'character_production_preparation_context',{}).abortSignal(signal).retry(false);check();if(r.error)throw Error('Preparation context unavailable');if(r.data===null)return null;const c=r.data as Context;if(!c||Object.keys(c).sort().join(',')!=='active,identity,lease,occurrenceId,sourceScope,speechStarted,textKey,textStarted,textState'||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.occurrenceId)||!/^daily:\d{4}-\d{2}-\d{2}:zaria-solenne$/.test(c.textKey)||typeof c.active!=='boolean'||typeof c.textStarted!=='boolean'||typeof c.speechStarted!=='boolean')throw Error('Exact preparation context required');return structuredClone(c)}
   const original=await read();if(!original)return {status:'unconfigured' as const}
   if(finite&&original.textKey!=='daily:2026-11-17:zaria-solenne')throw Error('Exact finite daily key required')
   const current=async()=>{const c=await read();if(!c?.active||c.occurrenceId!==original.occurrenceId||c.textKey!==original.textKey||c.textKey!==`daily:${day()}:zaria-solenne`||JSON.stringify([c.sourceScope,c.lease,c.identity])!==JSON.stringify([original.sourceScope,original.lease,original.identity]))throw Error('Preparation authority or identity changed');check()}
   const claim=async(phase:'text'|'speech')=>{await current();if(phase==='speech'&&process.env.CS_CHARACTER_FRESH_INCLUDED_SPEECH_ENABLED!=='true')throw Error('Speech preparation disabled');if(phase==='text'&&(process.env.CS_CHARACTER_TEXT_REPLENISHMENT_ENABLED!=='true'||process.env.CS_CHARACTER_TEXT_RECEIPT_EVIDENCE_ENABLED!=='true'||process.env.CS_CHARACTER_TEXT_CHECKPOINT_ENABLED!=='true'))throw Error('Text preparation disabled');const r=await db.rpc(finite?'character_production_finite_test_claim':recovery?'character_production_private_recovery_claim':'character_production_preparation_claim',recovery?{p_occurrence:original.occurrenceId}:{p_occurrence:original.occurrenceId,p_phase:phase}).abortSignal(signal).retry(false);check();if(r.error)throw Error('Preparation phase claim unknown');return r.data===true}
   if(recovery&&original.identity)return {status:'held_original_text' as const}
   if(!original.identity){
    if(original.textStarted||original.textState!==null)return {status:'held_original_text' as const}
    if(!original.active||!original.sourceScope||!original.lease||original.textKey!==`daily:${day()}:zaria-solenne`)return {status:'held_authority' as const}
    if(original.textKey==='daily:2026-11-16:zaria-solenne')return {status:'held_original_text' as const}
    if(process.env.CS_CHARACTER_TEXT_REPLENISHMENT_ENABLED!=='true'||process.env.CS_CHARACTER_TEXT_RECEIPT_EVIDENCE_ENABLED!=='true'||process.env.CS_CHARACTER_TEXT_CHECKPOINT_ENABLED!=='true')return {status:'held_text_disabled' as const}
    const receiptReady=await probeTextReceipt(args=>db.rpc('character_production_text_receipt',args).abortSignal(signal).retry(false));check()
    const checkpointReady=receiptReady&&await probeTextCheckpoint(args=>db.rpc('character_production_text_checkpoint',args).abortSignal(signal).retry(false));check()
    if(!checkpointReady)return {status:'held_receipt_unavailable' as const}
    if(!await claim('text'))return {status:'held_original_text' as const}
    const operation=createReplenishmentOperation({scope:original.sourceScope,lease:original.lease,deadlineMs:80000,expectedKey:original.textKey,current});child=operation
    const result=await operation.run(signal);await operation.whenSettled();check();return {status:'text_phase_finished' as const,result}
   }
   if(!original.speechStarted&&original.active&&original.textKey===`daily:${day()}:zaria-solenne`){
    if(process.env.CS_CHARACTER_FRESH_INCLUDED_SPEECH_ENABLED!=='true')return {status:'held_speech_disabled' as const}
    if(!await claim('speech'))return {status:'held_original_speech' as const}
    const operation=(finite?createFiniteNov17SpeechOperation:createFreshSpeechOperation)(80000,original.identity,current,enabled);child=operation
    const result=await operation.run(signal);await operation.whenSettled();check();return {status:'speech_phase_finished' as const,result}
   }
   // Never reconstruct a current speech operation for yesterday's saved text.
   const receiptReader=createFreshSpeechReceiptReader(original.identity,{storage:db.storage,signal,enabled,timeoutMs:60000});child=receiptReader
   const receipt=await receiptReader.recover();await receiptReader.whenSettled();check()
   return {status:'original_speech_verified' as const,occurrenceId:original.occurrenceId,receipt,currentAuthorityVerified:false as const}
  })();return await work
 },async whenSettled(){closing=true;const done=await Promise.allSettled(work?[work]:[]);const drains=await Promise.allSettled([child?.whenSettled(),network?.whenSettled()]);if([...done,...drains].some(r=>r.status==='rejected'))throw Error('Preparation settled with failure')}}
}
