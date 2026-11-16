import 'server-only'
import {createHash} from 'node:crypto'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {createFreshSpeechReceiptReader,type PersistedFreshTextIdentity} from './character-production-fresh-speech-receipt-store'
import {createPrivateCanonicalImageSource} from './character-production-private-image'
import {createPrivateRenderedAudioSource} from './character-production-private-audio'
import {createDirectHeyGenApi} from './character-production-heygen-direct'
import {liveGlyphCharacters} from './glyph-live'
import {normalizePromoCanon} from './character-promo-sources'
import {createPlannerValidator} from './character-production-planner-validation'
import {createPlannerImageBindingReader} from './character-production-planner-image-binding'
import {createPlannerPolicySource} from './character-production-planner-policy-source'
import {productionSlotDigest,type ProductionSlot} from './character-production-engine'
import {imageApprovedAvatar,type CanonicalImageBinding} from './character-production-canonical-image'
import {heyGenBindingRevision} from './character-production-provider-heygen'
import {verifyBindingSnapshot,type BindingSnapshot} from './character-production-binding-snapshot'
import {createTrustedPlannerComposition,type TrustedPlannerManifest} from './character-production-planner-trusted-composition'
import {createPlannerEntry,type ReviewedPlannerEnrollment} from './character-production-planner-entry'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
type Accepted={id:string;manifestSha256:string;ordinals:number[];manifest:string}
type Context={active:boolean;occurrenceId:string;identity:PersistedFreshTextIdentity;actorId:string;policyId:string;policyRevision:number;capCents:number;period:string;expiresAt:number;theme:string;ownerEvidenceRef:string;generationAt:string;draftId:string;enrollmentId:string;image:{avatarId:string;canonicalRevision:string;portraitSha256:string;imageBytes:number;mime:'image/png'|'image/jpeg';approvedScene?:{imageSha256:string;approvalReference:string}};account:BindingSnapshot['account'];quote:{cents:number;durationSeconds:number;observedAt:number;expiresAt:number;evidenceRef:string};rightsEvidenceRef:string;accepted:Accepted|null}
const sha=(v:string)=>createHash('sha256').update(v).digest('hex')
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)
/** Dormant one-phase first admission/planning operation. No request body, caller
 * actor, successor, retry, synthesis or video POST. New authority capability
 * requires separate live review. Retained manifests never renew old authority. */
export function createCafeFirstAdmissionOperation(){
 const enabled=()=>process.env.CS_CHARACTER_FIRST_ADMISSION_ENABLED==='true'
 let used=false,closing=false,work:Promise<unknown>|undefined,network:ReturnType<typeof createProductionFetch>|undefined
 const pending=new Set<Promise<unknown>>(),mediaDrains:Array<()=>Promise<void>>=[]
 const track=<T>(p:Promise<T>)=>{pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p}
 let recovery:ReturnType<typeof createFreshSpeechReceiptReader>|undefined
 return {async run(parent:AbortSignal){
  if(used||closing||parent.aborted||!enabled())return {status:'disabled' as const}
  used=true;const signal=AbortSignal.any([parent,AbortSignal.timeout(85000)])
  const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('First admission disabled')}
  work=(async()=>{
   network=createProductionFetch(signal,(input,init)=>{check();init?.signal?.throwIfAborted();return fetch(input,init)});const db=createAdminClient(network.fetch)
   const read=async()=>{check();const r=await db.rpc('character_production_first_admission_context',{}).abortSignal(signal).retry(false);check();if(r.error)throw Error('First admission context unavailable');if(r.data===null)return null;const c=structuredClone(r.data) as Context;if(!c||![c.occurrenceId,c.actorId,c.policyId,c.draftId,c.enrollmentId].every(uuid)||typeof c.active!=='boolean'||!c.identity||c.account?.expectedUsername!=='d61468fdf18c4b478f27857337ddd1ea')throw Error('Invalid admission context');return c}
   const c=await read();if(!c)return {status:'unconfigured' as const}
   const accepted=(a:Accepted):ReviewedPlannerEnrollment=>{
    if(a.id!==c.enrollmentId||!same(a.ordinals,[0])||typeof a.manifest!=='string'||Buffer.byteLength(a.manifest)>65536||sha(a.manifest)!==a.manifestSha256)throw Error('Original manifest receipt unavailable')
    const manifest=JSON.parse(a.manifest) as TrustedPlannerManifest
    if(manifest.candidates?.length!==1||manifest.images?.length!==1||manifest.candidates[0].draftId!==c.draftId||manifest.candidates[0].slot.key!=='first:'+c.occurrenceId)throw Error('Original enrollment identity changed')
    return {id:a.id,manifestSha256:a.manifestSha256,ordinals:[0],manifest}
   }
   const origin=process.env.NEXT_PUBLIC_SUPABASE_URL
   const sources=(manifest:TrustedPlannerManifest,plannerDb:ProductionServerRpcClient,resolveActor:(s:AbortSignal)=>Promise<string|null>)=>{
    if(!origin)throw Error('Private media origin unavailable')
    const images=createPrivateCanonicalImageSource(db.storage,origin,manifest.images.map(x=>x.image)),audio=createPrivateRenderedAudioSource(db.storage,origin,manifest.images.map(x=>x.image.audio))
    mediaDrains.push(()=>images.whenSettled(),()=>audio.whenSettled())
    const api=createDirectHeyGenApi(()=>process.env.HEYGEN_API_KEY,network!.fetch,8000,8000)
    return {db:plannerDb,images,audio,readAccount:(s:AbortSignal)=>track(api.account(s)),readCanon:(s:AbortSignal)=>track(liveGlyphCharacters(s)),normalizeCanon:normalizePromoCanon,resolveActor}
   }
   const current=async()=>{const n=await read();if(!n?.active||!same(n,c)||Date.now()>=c.expiresAt)throw Error('Admission authority changed');check()}
   if(c.accepted){
    const enrollment=accepted(c.accepted)
    if(!c.active)return {status:'original_enrollment_retained' as const,enrollment,currentAuthorityVerified:false as const}
    await current()
    // Existing scoped entry restricts all planner reads/writes to this exact
    // stored candidate. No raw plan_bound fallback or fresh caller manifest.
    const entry=createPlannerEntry(enrollment,{enabled,authorize:()=>true,open:()=>db,create:(manifest,actor,open)=>{const runner=createTrustedPlannerComposition(manifest,Date.now,inner=>{const scoped=open(inner);if(!scoped)throw Error('Scoped planner unavailable');return sources(manifest,scoped,actor)});return {tick:inner=>track(runner.tick(inner))}}})
    const result=await entry.run(null,signal);check()
    return {status:'original_planning_phase_finished' as const,result,enrollment}
   }
   if(!c.active)return {status:'held_authority' as const}
   recovery=createFreshSpeechReceiptReader(c.identity,{storage:db.storage,signal,enabled,timeoutMs:45000})
   const r=await recovery.recover();await recovery.whenSettled();check()
   if(r.status!=='private_audio_receipt_verified'||r.originalOperation.characterId!=='zaria-solenne'||r.originalOperation.scriptSha256!==c.identity.scriptSha256||r.canonicalRevision!==c.image.canonicalRevision||r.originalOperation.portraitSha256!==c.image.portraitSha256||!Number.isFinite(r.durationSeconds)||r.durationSeconds<8||r.durationSeconds>c.quote.durationSeconds||!Number.isSafeInteger(c.quote.durationSeconds)||c.quote.durationSeconds<8||c.quote.durationSeconds>45)throw Error('Original media does not fit reviewed image/quote')
   const image:CanonicalImageBinding={characterId:'zaria-solenne',canonicalRevision:r.canonicalRevision,portraitSha256:r.originalOperation.portraitSha256,imageBytes:c.image.imageBytes,mime:c.image.mime,...(c.image.approvedScene?{approvedScene:c.image.approvedScene}:{}),audio:{characterId:'zaria-solenne',avatarId:c.image.avatarId,voiceId:r.voiceId,voiceModel:r.modelId,canonicalRevision:r.canonicalRevision,portraitSha256:r.originalOperation.portraitSha256,scriptSha256:r.scriptSha256,audioSha256:r.audioSha256,audioBytes:r.audioBytes,mime:'audio/mpeg',provider:'elevenlabs',synthesisReceiptId:r.requestId}}
   const snapshot:BindingSnapshot={version:1,account:c.account,image,speech:{key:r.key,claimSha256:r.claimSha256,receiptSha256:r.receiptSha256,scopeId:r.sourceScope.scopeId,textAttemptKey:c.identity.textAttemptKey,textAttemptToken:c.identity.textAttemptToken,textSourceDigest:c.identity.textSourceDigest}}
   const snapshotText=JSON.stringify(snapshot)
   const slot:ProductionSlot={key:'first:'+c.occurrenceId,characterId:'zaria-solenne',script:r.originalOperation.script,canonicalRevision:r.canonicalRevision,voiceId:r.voiceId,portraitSha256:r.originalOperation.portraitSha256,providerBindingRevision:heyGenBindingRevision(c.account,imageApprovedAvatar(image)),provider:'heygen',model:'avatar_iv',durationSeconds:c.quote.durationSeconds,authorizationId:'first:'+c.occurrenceId,authorizationExpiresAt:c.expiresAt,period:c.period,quoteCents:c.quote.cents,periodCapCents:c.capCents}
   verifyBindingSnapshot(snapshotText,sha(snapshotText),slot)
   const heygen={linkId:c.account.linkId,model:c.account.model,aspectRatio:c.account.aspectRatio}
   const manifest:TrustedPlannerManifest={enabled:true,deadlineMs:30000,heygen,expectedUsername:c.account.expectedUsername,images:[{image,snapshotText,themes:[c.theme],rightsEvidenceRef:c.rightsEvidenceRef,quoteEvidenceRef:c.quote.evidenceRef,quoteCents:c.quote.cents,durationSeconds:c.quote.durationSeconds,quoteObservedAt:c.quote.observedAt,quoteExpiresAt:c.quote.expiresAt}],candidates:[{slot,draftId:c.draftId,scheduledAt:c.generationAt,theme:c.theme,policyId:c.policyId,policyRevision:c.policyRevision}]}
   const s=sources(manifest,db,async()=>c.actorId)
   const validator=createPlannerValidator({now:Date.now,readPolicy:createPlannerPolicySource(db,Date.now),readCanon:s.readCanon,normalizeCanon:s.normalizeCanon,readBinding:createPlannerImageBindingReader({config:heygen,manifests:manifest.images,images:s.images,audio:s.audio,readAccount:s.readAccount,expectedUsername:c.account.expectedUsername,now:Date.now})})
   await current();if(Date.now()>=Date.parse(c.generationAt))throw Error('Original admission time missed')
   const proof=await validator({...manifest.candidates[0],actorId:c.actorId},productionSlotDigest(slot),signal);if(!proof)throw Error('Current planner source validation failed')
   await current();const text=JSON.stringify(manifest)
   const result=await db.rpc('character_production_first_admit',{p_occurrence:c.occurrenceId,p_manifest_text:text}).abortSignal(signal).retry(false);check()
   if(result.error||!result.data)return {status:'held_admission_outcome' as const}
   const record=result.data as Accepted;if(record.manifest!==text)throw Error('Admission manifest changed')
   return {status:'first_enrollment_admitted' as const,enrollment:accepted(record),planned:false as const,paidProviderCalls:0 as const}
  })();return await work
 },async whenSettled(){closing=true;const done=await Promise.allSettled(work?[work]:[]);while(pending.size)await Promise.allSettled([...pending]);const drains=await Promise.allSettled([recovery?.whenSettled(),...mediaDrains.map(d=>d()),network?.whenSettled()]);if([...done,...drains].some(x=>x.status==='rejected'))throw Error('First admission settled with failure')}}
}
