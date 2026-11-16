import 'server-only'
import {createHash} from 'node:crypto'
import type {PersistedFreshTextIdentity} from './character-production-fresh-speech-receipt-store'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {liveGlyphCharacters} from './glyph-live'
import {normalizePromoCanon} from './character-promo-sources'
import {replenishmentDigest} from './character-production-replenishment'
import {bindFreshIncludedSpeech,type SavedTextAttempt,type FreshSpeechAuthority} from './character-production-fresh-speech-binding'
import {runIncludedSpeechOperation} from './character-production-included-speech-operation'
import {createIncludedOperationStore,createIncludedOperationProvider} from './character-production-included-speech-operation-io'
import {measureIncludedMp3Duration} from './character-production-speech-duration'
type Snapshot={scopeId:string;attempt:SavedTextAttempt;authority:FreshSpeechAuthority}
/** Dormant exact daily Zaria operation. No caller-selected authority, key, voice,
 * model, budget, script, RPC or public post. RPC grant is separately reviewed;
 * no direct private-table fallback or implied authority from a text budget. */
export function createFreshSpeechOperation(deadlineMs=85000,expected?:PersistedFreshTextIdentity,currentPreparation?:()=>Promise<void>,allowed:()=>boolean=()=>true){return createSpeechOperation(deadlineMs,expected,currentPreparation,allowed,false)}
export function createFiniteNov17SpeechOperation(deadlineMs:number,expected:PersistedFreshTextIdentity,currentPreparation:()=>Promise<void>,allowed:()=>boolean){
 if(expected.textAttemptKey!=='daily:2026-11-17:zaria-solenne')throw Error('Exact finite speech identity required')
 return createSpeechOperation(deadlineMs,expected,currentPreparation,()=>allowed()&&process.env.CS_CHARACTER_FINITE_NOV17_TEST_ENABLED==='true'&&Date.now()>=Date.parse('2026-11-17T06:00:00Z')&&Date.now()<Date.parse('2026-11-18T06:00:00Z'),true)
}
function createSpeechOperation(deadlineMs:number,expected:PersistedFreshTextIdentity|undefined,currentPreparation:(()=>Promise<void>)|undefined,allowed:()=>boolean,finite:boolean){
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1000||deadlineMs>85000)throw Error('Invalid speech deadline')
 const identity=expected?structuredClone(expected):undefined
 const enabled=()=>allowed()&&process.env.CS_CHARACTER_FRESH_INCLUDED_SPEECH_ENABLED==='true'
 let consumed=false,closing=false,work:Promise<unknown>|undefined,network:ReturnType<typeof createProductionFetch>|undefined,provider:ReturnType<typeof createIncludedOperationProvider>|undefined
 return {
  async run(parent:AbortSignal){
   if(consumed||closing||parent.aborted||!enabled())return {status:'disabled' as const}
   consumed=true
   const signal=AbortSignal.any([parent,AbortSignal.timeout(deadlineMs)])
   work=(async()=>{
    const active=()=>{signal.throwIfAborted();if(!enabled())throw Error('Fresh speech disabled')}
    active();network=createProductionFetch(signal);const db=createAdminClient(network.fetch)
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Date.now()),part=(t:string)=>parts.find(p=>p.type===t)!.value
    const key=`daily:${part('year')}-${part('month')}-${part('day')}:zaria-solenne`
    const read=async():Promise<Snapshot>=>{
     active();await currentPreparation?.();const r=await db.rpc(finite?'character_production_finite_test_speech_source':'character_production_fresh_speech_source',{p_key:key}).abortSignal(signal).retry(false);active()
     if(r.error||!r.data||typeof r.data!=='object'||Object.keys(r.data).sort().join(',')!=='attempt,authority,scopeId'||! /^[a-f0-9-]{36}$/.test(r.data.scopeId)||r.data.attempt?.key!==key)throw Error('Current fresh speech source unavailable')
     return structuredClone(r.data) as Snapshot
    }
    const original=await read(),script=(original.attempt.output as {spokenScript?:unknown}|null)?.spokenScript;if(identity&&(identity.textAttemptKey!==original.attempt.key||identity.textAttemptToken!==original.attempt.token||identity.textSourceDigest!==original.attempt.source_digest||typeof script!=='string'||identity.scriptSha256!==createHash('sha256').update(script).digest('hex')))throw Error('Original preparation identity changed');const fingerprint=replenishmentDigest(original)
    const current=async()=>{const v=await read();if(replenishmentDigest(v)!==fingerprint)throw Error('Speech source or authority changed');if(Date.now()>=v.authority.expiresAt)throw Error('Speech authority expired')}
    const canon=async()=>{active();const body=await liveGlyphCharacters(signal);active();return normalizePromoCanon(body,'zaria-solenne',new Date().toISOString())}
    const operation=bindFreshIncludedSpeech(original.attempt,await canon(),original.authority,Date.now())
    const validate=async()=>{await current();const checked=bindFreshIncludedSpeech(original.attempt,await canon(),original.authority,Date.now());if(replenishmentDigest(checked)!==replenishmentDigest(operation))throw Error('Speech binding changed');await current();active()}
    const base=createIncludedOperationStore(operation,db.storage,signal)
    const gate=async<T>(action:()=>Promise<T>)=>{await current();const value=await action();await current();return value}
    const store={preflight:()=>gate(()=>base.preflight()),claim:(b:Uint8Array)=>gate(()=>base.claim(b)),readClaim:()=>gate(()=>base.readClaim()),providerReceipt:(b:Uint8Array)=>gate(()=>base.providerReceipt(b)),readProviderReceipt:()=>gate(()=>base.readProviderReceipt()),audio:(b:Uint8Array,h:string)=>gate(()=>base.audio(b,h)),readAudio:(h:string,n:number)=>gate(()=>base.readAudio(h,n)),receipt:(b:Uint8Array)=>gate(()=>base.receipt(b)),readReceipt:()=>gate(()=>base.readReceipt())}
    // Native fetch only: awaited fresh scope/canon checks happen inside the
    // provider's actual POST boundary, followed by local deadline rechecks.
    provider=createIncludedOperationProvider(operation,process.env.ELEVENLABS_API_KEY??'',signal,fetch,validate,active)
    return runIncludedSpeechOperation(operation,{freshSourceScope:{scopeId:original.scopeId,textAttemptKey:original.attempt.key,textAttemptToken:original.attempt.token,textSourceDigest:original.attempt.source_digest},signal,now:Date.now,canon:validate,quota:()=>gate(()=>provider!.quota()),store,synthesize:()=>gate(()=>provider!.synthesize()),measureDuration:b=>gate(async()=>measureIncludedMp3Duration(b))})
   })()
   return await work
  },
  async whenSettled(){closing=true;const done=await Promise.allSettled(work?[work]:[]);const drained=await Promise.allSettled([network?.whenSettled(),provider?.whenSettled()]);if([...done,...drained].some(r=>r.status==='rejected'))throw Error('Fresh speech settled with failure')},
 }
}

