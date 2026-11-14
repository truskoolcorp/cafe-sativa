import {productionSlotDigest} from './character-production-engine.ts'
import {createCharacterProductionPlanner} from './character-production-planner.ts'
import type {PlannerInput} from './character-production-planner.ts'
import {createPlannerScheduler} from './character-production-planner-scheduler.ts'
import {createPlannerPolicySource} from './character-production-planner-policy-source.ts'
import {createPlannerValidator} from './character-production-planner-validation.ts'
import {createPlannerImageBindingReader} from './character-production-planner-image-binding.ts'
import type {PlannerImageManifest} from './character-production-planner-image-binding.ts'
import type {ProductionServerRpcClient} from './character-production-server-rpc.ts'
import type {PrivateMediaSource} from './character-production-canonical-image.ts'
import type {HeyGenConfig} from './character-production-provider-heygen.ts'
export type TrustedPlannerManifest=Readonly<{enabled:boolean;deadlineMs:number;heygen:Pick<HeyGenConfig,'linkId'|'model'|'aspectRatio'>;expectedUsername:string;images:readonly PlannerImageManifest[];candidates:readonly Omit<PlannerInput,'actorId'>[]}>
export interface TrustedPlannerSources {
 db:ProductionServerRpcClient;images:PrivateMediaSource;audio:PrivateMediaSource;
 readAccount(signal:AbortSignal):Promise<unknown>;
 readCanon(signal:AbortSignal):Promise<unknown>;
 normalizeCanon(body:unknown,characterId:string,observedAt:string):unknown;
 /** Must resolve authenticated server identity now, never return a request UUID
  * or a guessed scheduler owner. Unsupported unattended identity returns null. */
 resolveActor(signal:AbortSignal):Promise<string|null>;
}
/** Code-owned reviewed candidates only; no request payload or fallback candidate.
 * This composes planning, not generation or publication. No route is registered.
 */
export function createTrustedPlannerComposition(manifest:TrustedPlannerManifest,now:()=>number,open:(signal:AbortSignal)=>TrustedPlannerSources){
 const enabled=manifest.enabled===true,deadlineMs=manifest.deadlineMs,heygen=Object.freeze({...manifest.heygen}),username=manifest.expectedUsername
 const images=manifest.images.map(m=>Object.freeze({...m,themes:Object.freeze([...m.themes]),image:Object.freeze({...m.image,audio:Object.freeze({...m.image.audio}),...(m.image.approvedScene?{approvedScene:Object.freeze({...m.image.approvedScene})}:{})})}))
 if(manifest.candidates.length>32)throw Error('Candidate manifest exceeds reconciliation bound')
 const candidates=manifest.candidates.map(c=>{if(Object.keys(c).includes('actorId'))throw Error('Candidate cannot supply actor');return Object.freeze({...c,slot:Object.freeze({...c.slot})})})
 const clock=now
 return {async tick(signal:AbortSignal){
  const lifetime=new AbortController(),abort=()=>lifetime.abort()
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
  try{return await createPlannerScheduler({enabled,deadlineMs},()=>{
   const d=open(lifetime.signal),resolve=d.resolveActor.bind(d)
   const validator=createPlannerValidator({now:clock,readPolicy:createPlannerPolicySource(d.db,clock),readCanon:d.readCanon.bind(d),normalizeCanon:d.normalizeCanon.bind(d),readBinding:createPlannerImageBindingReader({config:heygen,manifests:images,images:d.images,audio:d.audio,readAccount:d.readAccount.bind(d),expectedUsername:username,now:clock})},Math.min(deadlineMs,8000))
   const planner=createCharacterProductionPlanner({enabled:true,now:clock},()=>({db:d.db,validateCurrent:validator}))
   return {planner,async readCandidate(inner:AbortSignal){
    if(inner.aborted)return null
    const at=clock(),eligible=candidates.filter(c=>Date.parse(c.scheduledAt)>=at&&Date.parse(c.scheduledAt)<=at+86400000&&c.slot.authorizationExpiresAt>Date.parse(c.scheduledAt)).sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)||a.slot.key.localeCompare(b.slot.key))
    if(!eligible.length)return null
    // Persisted reconciliation survives runtime restarts. No service-role fallback,
    // retry or inferred success. Capability must include this exact boolean RPC.
    for(const candidate of eligible){
     if(inner.aborted)return null
     const result=await d.db.rpc('character_production_planned_draft',{p_id:candidate.draftId,p_slot:candidate.slot,p_digest:productionSlotDigest(candidate.slot),p_theme:candidate.theme}).abortSignal(inner).retry(false)
     if(inner.aborted)return null
     if(result.error||typeof result.data!=='boolean')throw Error('Planning reconciliation unavailable')
     if(result.data)continue
     const actor=await resolve(inner)
     if(inner.aborted||!actor)return null
     return Object.freeze({...candidate,actorId:actor})
    }
    return null
   }}
  }).tick(lifetime.signal)}finally{lifetime.abort();signal.removeEventListener('abort',abort)}
 }}
}
