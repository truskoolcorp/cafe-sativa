import {verifyBindingSnapshot} from './character-production-binding-snapshot.ts'
import type {ProductionSlot} from './character-production-engine.ts'
import {createHash} from 'node:crypto'
import {productionSlotDigest} from './character-production-engine.ts'
import {canonicalImageDigest,canonicalImagePath,imageApprovedAvatar,verifyCanonicalImage} from './character-production-canonical-image.ts'
import type {CanonicalImageBinding,PrivateMediaSource} from './character-production-canonical-image.ts'
import {renderedAudioPath,verifyRenderedAudio} from './character-production-rendered-audio.ts'
import {heyGenBindingRevision} from './character-production-provider-heygen.ts'
import type {HeyGenConfig} from './character-production-provider-heygen.ts'
import type {PlannerValidationSources} from './character-production-planner-validation.ts'
/** Server-owned reviewed manifest, not an HTTP payload. Quote proof must be
 * refreshed separately; this read path cannot authorize wallet spending. */
export type PlannerImageManifest=Readonly<{image:CanonicalImageBinding;snapshotText?:string;themes:readonly string[];rightsEvidenceRef:string;quoteEvidenceRef:string;quoteCents:number;durationSeconds:number;quoteObservedAt:number;quoteExpiresAt:number}>
/** An all-bound manifest must match each original slot exactly. Never mix static
 * and occurrence evidence or attach a snapshot unrelated to the verified media. */
export function plannerSnapshotForSlot(manifests:readonly PlannerImageManifest[],slot:ProductionSlot):string|undefined{
 if(!manifests.some(m=>m.snapshotText!==undefined))return undefined
 if(manifests.some(m=>typeof m.snapshotText!=='string'))throw Error('Mixed bound/static planner proofs')
 const matches=manifests.filter(m=>{try{const b=verifyBindingSnapshot(m.snapshotText!,createHash('sha256').update(m.snapshotText!).digest('hex'),slot);return canonicalImageDigest(b.image)===canonicalImageDigest(m.image)}catch{return false}})
 if(matches.length!==1)throw Error('Exact bound planner snapshot unavailable')
 return matches[0].snapshotText!
}
export function createPlannerImageBindingReader(d:{config:Pick<HeyGenConfig,'linkId'|'model'|'aspectRatio'>;manifests:readonly PlannerImageManifest[];images:PrivateMediaSource;audio:PrivateMediaSource;readAccount(signal:AbortSignal):Promise<unknown>;expectedUsername:string;now():number}):PlannerValidationSources['readBinding']{
 const now=d.now.bind(d),readAccount=d.readAccount.bind(d),username=d.expectedUsername,readImage=d.images.read.bind(d.images),readAudio=d.audio.read.bind(d.audio)
 const config=Object.freeze({...d.config}),manifests=d.manifests.map(m=>Object.freeze({...m,themes:Object.freeze([...m.themes]),image:Object.freeze({...m.image,audio:Object.freeze({...m.image.audio}),...(m.image.approvedScene?{approvedScene:Object.freeze({...m.image.approvedScene})}:{})})}))
 if(!config.linkId||config.model!=='avatar_iv'||username!=='d61468fdf18c4b478f27857337ddd1ea')throw Error('Planner account required')
 for(const m of manifests){canonicalImageDigest(m.image);if(!m.rightsEvidenceRef?.trim()||!m.quoteEvidenceRef?.trim()||m.rightsEvidenceRef.length>500||m.quoteEvidenceRef.length>500||!Number.isSafeInteger(m.quoteCents)||m.quoteCents<1||m.quoteCents>2000||!Number.isSafeInteger(m.durationSeconds)||m.durationSeconds<8||m.durationSeconds>45||!Number.isSafeInteger(m.quoteObservedAt)||!Number.isSafeInteger(m.quoteExpiresAt)||m.quoteExpiresAt<=m.quoteObservedAt||m.quoteExpiresAt>m.quoteObservedAt+86400000)throw Error('Reviewed manifest required')}
 return async(i,digest,signal)=>{try{
  if(signal.aborted||productionSlotDigest(i.slot)!==digest)return null
  const matches=manifests.filter(m=>m.image.characterId===i.slot.characterId&&m.image.canonicalRevision===i.slot.canonicalRevision&&m.image.portraitSha256===i.slot.portraitSha256&&m.image.audio.voiceId===i.slot.voiceId&&m.image.audio.scriptSha256===createHash('sha256').update(i.slot.script).digest('hex')&&heyGenBindingRevision(config,imageApprovedAvatar(m.image))===i.slot.providerBindingRevision&&m.themes.includes(i.theme)&&m.quoteCents===i.slot.quoteCents&&m.durationSeconds===i.slot.durationSeconds)
  if(matches.length!==1)return null
  const m=matches[0],fresh=()=>!signal.aborted&&m.quoteObservedAt<=now()&&m.quoteExpiresAt>now()
  if(!fresh())return null
  const account=await readAccount(signal) as {error?:unknown;data?:{username?:unknown}}
  if(!fresh()||!account||account.error||account.data?.username!==username)return null
  const image=await readImage(canonicalImagePath(m.image),m.image.imageBytes,signal)
  const audio=await readAudio(renderedAudioPath(m.image.audio),m.image.audio.audioBytes,signal)
  if(!fresh()||!verifyCanonicalImage(m.image,image)||!verifyRenderedAudio(m.image.audio,i.slot.script,i.slot.voiceId,audio))return null
  const snapshotText=plannerSnapshotForSlot(manifests,i.slot)
  if(snapshotText){const b=verifyBindingSnapshot(snapshotText,createHash('sha256').update(snapshotText).digest('hex'),i.slot);if(b.account.linkId!==config.linkId||b.account.model!==config.model||b.account.aspectRatio!==config.aspectRatio||b.account.expectedUsername!==username)return null}
  // Attach the immutable snapshot hash only AFTER all original proof checks.
  const evidenceRef=snapshotText?'binding-snapshot-sha256:'+createHash('sha256').update(snapshotText).digest('hex'):'sha256:'+createHash('sha256').update(JSON.stringify([m.rightsEvidenceRef,m.quoteEvidenceRef,canonicalImageDigest(m.image)])).digest('hex')
  return {digest,providerBindingRevision:i.slot.providerBindingRevision,accountId:username,sourceBound:true,rightsApproved:true,themeApproved:true,quoteCents:m.quoteCents,observedAt:new Date(now()).toISOString(),evidenceRef}
 }catch{return null}}
}
