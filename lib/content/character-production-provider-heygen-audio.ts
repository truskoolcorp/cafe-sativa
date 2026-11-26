import {createHash} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import type {ProductionProvider,ProductionSlot} from './character-production-engine.ts'
import {createHeyGenProductionProvider,heyGenBindingRevision,validateHeyGenProductionConfig} from './character-production-provider-heygen.ts'
import type {ApprovedAvatar,AvatarModel,HeyGenCodecs,HeyGenConfig,HeyGenTransport} from './character-production-provider-heygen.ts'

/** Trusted immutable server receipt, not a caller assertion or asset metadata.
 * Source attests exact ElevenLabs synthesis; transfer attests identical bytes in
 * the specific HeyGen account/asset. Neither operation is performed here. */
export type CanonicalAudioTransferReceipt=Readonly<{
 sourceProvider:'elevenlabs';sourceModel:string;sourceSettingsSha256:string;
 sourceReceiptId:string;sourceReceiptRevision:string;transferReceiptId:string;transferReceiptRevision:string;
 characterId:string;canonicalRevision:string;portraitSha256:string;voiceId:string;
 scriptSha256:string;audioSha256:string;audioBytes:number;durationMs:number;
 heyGenLinkId:string;audioAssetId:string;slotKey:string;
 authorizationId:string;authorizationExpiresAt:number;period:string;quoteCents:number;periodCapCents:number;
}>
export type ApprovedAudioClip=Readonly<{avatar:ApprovedAvatar;audio:CanonicalAudioTransferReceipt}>
export type HeyGenAudioConfig=Readonly<Omit<HeyGenConfig,'bindings'>&{clips:readonly ApprovedAudioClip[]}>
/** Verified create_video_from_avatar subset. No script, voiceId or URL fallback. */
export type AudioAvatarArguments=Readonly<{
 link_id:string;avatarId:string;audioAssetId:string;engine:Readonly<{type:AvatarModel}>;
 aspectRatio:'9:16';outputFormat:'mp4';resolution:'1080p';
}>
export interface HeyGenAudioTransport {
 /** No automatic retries. Aborted/unknown writes require reconciliation. */
 create_video_from_avatar(args:AudioAvatarArguments,signal:AbortSignal):Promise<unknown>;
 get_video:HeyGenTransport['get_video'];
}
export interface CanonicalAudioVerifier {
 /** Trusted server must freshly verify exact immutable source+transfer receipts,
  * canonical rights, current ready approved avatar/model, and video generation/
  * data-sharing authorization+quote against these exact frozen inputs. It must
  * not infer provenance from filenames, asset metadata, names or client flags.
  * This read-only verification cannot perform synthesis, upload or generation. */
 validateCurrent(receipt:CanonicalAudioTransferReceipt,slot:ProductionSlot,signal:AbortSignal):Promise<boolean>;
}
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/.test(x)
const taskId=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(x)
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
function checkReceipt(a:CanonicalAudioTransferReceipt){
 if(!a||a.sourceProvider!=='elevenlabs'||![a.sourceModel,a.sourceReceiptId,a.transferReceiptId,a.characterId,a.voiceId,a.heyGenLinkId,a.audioAssetId,a.slotKey,a.authorizationId].every(id)||
  ![a.sourceSettingsSha256,a.sourceReceiptRevision,a.transferReceiptRevision,a.canonicalRevision,a.portraitSha256,a.scriptSha256,a.audioSha256].every(hash)||
  !Number.isSafeInteger(a.audioBytes)||a.audioBytes<1||a.audioBytes>25_000_000||!Number.isSafeInteger(a.durationMs)||a.durationMs<1||a.durationMs>180000||
  !Number.isSafeInteger(a.authorizationExpiresAt)||a.authorizationExpiresAt<1||typeof a.period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(a.period)||
  !Number.isSafeInteger(a.quoteCents)||a.quoteCents<1||!Number.isSafeInteger(a.periodCapCents)||a.periodCapCents<a.quoteCents)throw Error('Invalid canonical audio receipt')
}
export function heyGenAudioBindingRevision(c:Pick<HeyGenConfig,'linkId'|'model'>,clip:ApprovedAudioClip):string {
 if(!clip?.avatar||!clip.audio)throw Error('Invalid approved audio clip')
 const a=clip.audio,b=clip.avatar;checkReceipt(a)
 const base=heyGenBindingRevision(c,b)
 if(a.heyGenLinkId!==c.linkId||a.characterId!==b.characterId||a.canonicalRevision!==b.canonicalRevision||a.portraitSha256!==b.portraitSha256||a.voiceId!==b.voiceId)throw Error('Canonical audio transfer identity mismatch')
 return sha(JSON.stringify(['heygen-canonical-audio-binding-v2',base,
  a.sourceProvider,a.sourceModel,a.sourceSettingsSha256,a.sourceReceiptId,a.sourceReceiptRevision,a.transferReceiptId,a.transferReceiptRevision,
  a.characterId,a.canonicalRevision,a.portraitSha256,a.voiceId,a.scriptSha256,a.audioSha256,a.audioBytes,a.durationMs,
  a.heyGenLinkId,a.audioAssetId,a.slotKey,a.authorizationId,a.authorizationExpiresAt,a.period,a.quoteCents,a.periodCapCents]))
}
function baseConfig(c:HeyGenAudioConfig):HeyGenConfig {
 const map=new Map<string,ApprovedAvatar>()
 for(const clip of c.clips){const old=map.get(clip.avatar.characterId);if(old&&heyGenBindingRevision(c,old)!==heyGenBindingRevision(c,clip.avatar))throw Error('Ambiguous avatar binding');map.set(clip.avatar.characterId,clip.avatar)}
 return {...c,bindings:[...map.values()]}
}
export function validateHeyGenAudioProductionConfig(c:HeyGenAudioConfig):void {
 if(!c||c.enabled!==true)throw Error('HeyGen audio production disabled')
 if(!Array.isArray(c.clips)||!c.clips.length)throw Error('No approved canonical audio clips')
 const keys=new Set<string>()
 for(const clip of c.clips){heyGenAudioBindingRevision(c,clip);if(keys.has(clip.audio.slotKey))throw Error('Ambiguous audio slot');keys.add(clip.audio.slotKey)}
 validateHeyGenProductionConfig(baseConfig(c))
}
function snapshot(c:HeyGenAudioConfig):HeyGenAudioConfig {
 return Object.freeze({...c,mediaOrigins:Object.freeze([...c.mediaOrigins]),clips:Object.freeze(c.clips.map(x=>Object.freeze({avatar:Object.freeze({...x.avatar}),audio:Object.freeze({...x.audio})})))})
}
function matches(s:ProductionSlot,c:HeyGenAudioConfig,clip:ApprovedAudioClip):boolean {
 const a=clip.audio
 return s.provider==='heygen'&&s.model===c.model&&s.providerBindingRevision===heyGenAudioBindingRevision(c,clip)&&
  s.key===a.slotKey&&s.characterId===a.characterId&&s.canonicalRevision===a.canonicalRevision&&s.portraitSha256===a.portraitSha256&&s.voiceId===a.voiceId&&
  typeof s.script==='string'&&s.script.trim().length>0&&s.script.length<=5000&&sha(s.script)===a.scriptSha256&&
  s.durationSeconds===Math.ceil(a.durationMs/1000)&&s.authorizationId===a.authorizationId&&s.authorizationExpiresAt===a.authorizationExpiresAt&&s.authorizationExpiresAt>Date.now()&&
  s.period===a.period&&s.quoteCents===a.quoteCents&&s.periodCapCents===a.periodCapCents
}
/** One deadline includes preflight and provider request. Validate immediately
 * before deferred action as well as after await: blocked event loops cannot turn
 * an expired authorization into a paid request. */
async function bounded<T>(deadline:number,action:(signal:AbortSignal,current:()=>void)=>Promise<T>):Promise<T> {
 const started=Date.now(),remaining=deadline-started,until=performance.now()+remaining
 if(remaining<=0)throw Error('Audio authority expired')
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
 const current=()=>{if(controller.signal.aborted||performance.now()>=until||Date.now()>=deadline||Date.now()<started)throw Error('Audio deadline exceeded; write outcome may be unknown')}
 try{return await Promise.race([
  Promise.resolve().then(async()=>{current();const result=await action(controller.signal,current);current();return result}),
  new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Audio deadline exceeded; write outcome may be unknown'))},remaining)}),
 ])}finally{clearTimeout(timer);controller.abort()}
}
/** Compose with the engine's trusted current canonical/authorization validator.
 * Missing/revoked evidence fails before a claim; submit repeats after the claim. */
export function createCanonicalAudioSlotValidator(config:HeyGenAudioConfig,verifier:CanonicalAudioVerifier):(input:ProductionSlot)=>Promise<boolean> {
 const c=snapshot(config),verify=verifier.validateCurrent.bind(verifier)
 return async input=>{try{
  validateHeyGenAudioProductionConfig(c);const s=Object.freeze({...input}),clip=c.clips.find(x=>x.audio.slotKey===s.key)
  if(!clip||!matches(s,c,clip))return false
  return await bounded(Math.min(Date.now()+c.timeoutMs,s.authorizationExpiresAt),async(signal,current)=>{
   const valid=await verify(clip.audio,s,signal);current();return valid===true&&matches(s,c,clip)
  })
 }catch{return false}}
}
/** Local companion only; no production configuration, scheduler or automatic
 * activation. All provider output codecs remain separately injected. */
export function createHeyGenAudioProductionProvider(config:HeyGenAudioConfig,transport:HeyGenAudioTransport,codecs:HeyGenCodecs,verifier:CanonicalAudioVerifier):ProductionProvider {
 const c=snapshot(config),create=transport.create_video_from_avatar.bind(transport),get=transport.get_video.bind(transport)
 const decode=codecs.receipt.bind(codecs),status=codecs.status.bind(codecs),verify=verifier.validateCurrent.bind(verifier)
 let collector:ProductionProvider|undefined
 return Object.freeze({name:'heygen',async submit(input:ProductionSlot){
  validateHeyGenAudioProductionConfig(c);const s=Object.freeze({...input}),clip=c.clips.find(x=>x.audio.slotKey===s.key)
  if(!clip||!matches(s,c,clip))throw Error('Canonical audio slot mismatch or expired authority')
  return bounded(Math.min(Date.now()+c.timeoutMs,s.authorizationExpiresAt),async(signal,current)=>{
   if(await verify(clip.audio,s,signal)!==true)throw Error('Canonical audio transfer not currently verified')
   current();if(!matches(s,c,clip))throw Error('Canonical audio authority changed')
   const args=Object.freeze({link_id:c.linkId,avatarId:clip.avatar.avatarId,audioAssetId:clip.audio.audioAssetId,engine:Object.freeze({type:c.model}),aspectRatio:'9:16' as const,outputFormat:'mp4' as const,resolution:'1080p' as const})
   current();const raw=await create(args,signal);current();const result=decode(raw);current()
   if(!result||!taskId(result.taskId))throw Error('Invalid HeyGen audio receipt')
   return {taskId:result.taskId}
  })
 },async collect(originalTaskId:string,revision:string){
  validateHeyGenAudioProductionConfig(c);const clip=c.clips.find(x=>heyGenAudioBindingRevision(c,x)===revision)
  if(!clip)throw Error('Canonical audio binding revision mismatch')
  collector ||= createHeyGenProductionProvider(baseConfig(c),{create_video_from_avatar:async()=>{throw Error('Text generation forbidden')},get_video:get},{receipt:decode,status})
  return collector.collect(originalTaskId,heyGenBindingRevision(c,clip.avatar))
 }})
}
