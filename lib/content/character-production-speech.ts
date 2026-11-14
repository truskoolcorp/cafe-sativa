import {createHash} from 'node:crypto'
import type {ProductionRpc} from './character-production-store.ts'
import {renderedAudioDigest,renderedAudioPath,verifyRenderedAudio} from './character-production-rendered-audio.ts'
import type {RenderedAudioBinding} from './character-production-rendered-audio.ts'
const hash=(x:string|Uint8Array)=>createHash('sha256').update(x).digest('hex')
export type SpeechSlot=Readonly<{key:string;authorizationId:string;accountBinding:string;characterId:string;avatarId:string;voiceId:string;voiceModel:string;canonicalRevision:string;portraitSha256:string;script:string;period:string;expiresAt:number;quoteCents:number;periodCapCents:number;maxCharacters:number;maxAudioBytes:number}>
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(x)
export function speechSlotDigest(s:SpeechSlot){return hash(JSON.stringify(['speech-v1',s.key,s.authorizationId,s.accountBinding,s.characterId,s.avatarId,s.voiceId,s.voiceModel,s.canonicalRevision,s.portraitSha256,s.script,s.period,s.expiresAt,s.quoteCents,s.periodCapCents,s.maxCharacters,s.maxAudioBytes,'mp3_44100_128']))}
export interface SpeechOutputStore {preflight(maxBytes:number):Promise<boolean>;insert(path:string,bytes:Uint8Array):Promise<void>;read(path:string,maxBytes:number):Promise<Uint8Array>}
export interface SpeechProvider {synthesize(slot:SpeechSlot):Promise<{requestId:string;bytes:Uint8Array}>}
/** No defaults/credentials or scheduler. Provider and current canonical/account
 * validation explicitly injected. SQL claim reserves separate ElevenLabs budget. */
export function createSpeechProduction(config:{enabled:boolean;now():number},open:()=>{rpc:ProductionRpc;provider:SpeechProvider;storage:SpeechOutputStore;validateCurrent(slot:SpeechSlot):Promise<boolean>}){
 return {async produce(input:SpeechSlot){
  if(!config.enabled)return {status:'disabled' as const}
  const s=Object.freeze({...input}),now=config.now()
  if(![s.key,s.authorizationId,s.accountBinding,s.characterId,s.avatarId,s.voiceId,s.voiceModel].every(id)||!/^eleven_/.test(s.voiceModel)||![s.canonicalRevision,s.portraitSha256].every(v=>/^[a-f0-9]{64}$/.test(v))||typeof s.script!=='string'||!s.script.trim()||s.script.length>5000||!Number.isSafeInteger(s.maxAudioBytes)||s.maxAudioBytes<12||s.maxAudioBytes>32*1024*1024||!Number.isSafeInteger(s.maxCharacters)||s.maxCharacters<1||[...s.script].length>s.maxCharacters||!Number.isSafeInteger(s.expiresAt)||s.expiresAt<=now||s.period!==new Date(now).toISOString().slice(0,7)||!Number.isSafeInteger(s.quoteCents)||s.quoteCents<1||!Number.isSafeInteger(s.periodCapCents)||s.periodCapCents<s.quoteCents)return {status:'blocked' as const}
  let token:string|undefined,d:ReturnType<typeof open>|undefined
  try{
   d=open();if(!await d.storage.preflight(s.maxAudioBytes)||!await d.validateCurrent(s))return {status:'blocked' as const}
   const digest=speechSlotDigest(s),claim=await d.rpc.rpc('character_production_speech_claim',{p_slot:s,p_digest:digest})
   if(claim.error||!claim.data||typeof claim.data!=='object'||!('token'in claim.data)||!id(claim.data.token)||!('digest'in claim.data)||claim.data.digest!==digest)return {status:'held' as const}
   token=claim.data.token
   if(config.now()>=s.expiresAt||!await d.storage.preflight(s.maxAudioBytes)||!await d.validateCurrent(s)||config.now()>=s.expiresAt)throw Error('Authority changed')
   const receipt=await d.provider.synthesize(s)
   if(!id(receipt.requestId)||!(receipt.bytes instanceof Uint8Array)||receipt.bytes.length<12||receipt.bytes.length>s.maxAudioBytes)throw Error('Unconfirmed speech receipt')
   const bytes=Uint8Array.from(receipt.bytes),manifest:RenderedAudioBinding={characterId:s.characterId,avatarId:s.avatarId,voiceId:s.voiceId,voiceModel:s.voiceModel,canonicalRevision:s.canonicalRevision,portraitSha256:s.portraitSha256,scriptSha256:hash(s.script),audioSha256:hash(bytes),audioBytes:bytes.length,mime:'audio/mpeg',provider:'elevenlabs',synthesisReceiptId:receipt.requestId}
   if(!verifyRenderedAudio(manifest,s.script,s.voiceId,bytes))throw Error('Invalid speech media')
   const args={p_key:s.key,p_token:token,p_digest:digest,p_manifest:manifest,p_manifest_digest:renderedAudioDigest(manifest)}
   const saved=await d.rpc.rpc('character_production_speech_rendered',args)
   if(saved.error||saved.data!==true)throw Error('Receipt persistence unconfirmed')
   if(!await d.validateCurrent(s)||config.now()>=s.expiresAt)throw Error('Revoked')
   const path=renderedAudioPath(manifest)
   try{await d.storage.insert(path,bytes)}catch{/* uncertain write: exact readback only, never overwrite/retry */}
   const actual=await d.storage.read(path,bytes.length)
   if(!verifyRenderedAudio(manifest,s.script,s.voiceId,actual)||!await d.validateCurrent(s)||config.now()>=s.expiresAt)throw Error('Readback or authority rejected')
   const committed=await d.rpc.rpc('character_production_speech_verified',args)
   if(committed.error||committed.data!==true)throw Error('Attestation unconfirmed')
   return {status:'pending_qa' as const,manifest}
  }catch{
   if(d&&token)try{await d.rpc.rpc('character_production_speech_unknown',{p_key:s.key,p_token:token})}catch{/* no refund/reclaim */}
   return {status:'held' as const}
  }
 }}
}
