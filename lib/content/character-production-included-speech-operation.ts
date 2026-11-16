import {verifyFreshSpeechSourceScope,type FreshSpeechSourceScope} from './character-production-fresh-speech-provenance.ts'
import {createHash,randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex')
export type IncludedSpeechOperation=Readonly<{key:string;authorizationRef:string;script:string;scriptSha256:string;characterId:string;voiceId:string;modelId:string;canonicalRevision:string;portraitSha256:string;expiresAt:number;maxDurationSeconds:number}>
export const includedSpeechLimits=Object.freeze({maxBytes:1048576,minimumRemainingCredits:10000,format:'mp3_44100_128'})
export function validateIncludedSpeechOperation(s:IncludedSpeechOperation){
 if(!/^[a-z0-9][a-z0-9-]{1,100}$/.test(s.key)||s.key==='zaria-eleven-v4-included-canary-v1'||!s.authorizationRef||s.authorizationRef.length>500||s.characterId!=='zaria-solenne'||s.voiceId!=='5zneNR4v1Uw5AjIZ9Un4'||s.modelId!=='eleven_v4'||typeof s.script!=='string'||!s.script.trim()||Array.from(s.script).length>250||hash(s.script)!==s.scriptSha256||![s.canonicalRevision,s.portraitSha256].every(h=>/^[a-f0-9]{64}$/.test(h))||!Number.isSafeInteger(s.expiresAt)||!Number.isFinite(s.maxDurationSeconds)||s.maxDurationSeconds<1||s.maxDurationSeconds>30)throw Error('operation_unverified')
}
export function includedOperationQuota(s:IncludedSpeechOperation,subscription:any,models:any,voice:any){
 validateIncludedSpeechOperation(s)
 const q=subscription,cap=q?.max_credit_limit_extension
 if(!q||!Number.isSafeInteger(q.character_count)||q.character_count<0||!Number.isSafeInteger(q.character_limit)||q.character_limit<q.character_count||!['active','trialing','free'].includes(q.status)||q.can_extend_character_limit!==false||typeof q.allowed_to_extend_character_limit!=='boolean'||!(cap==='unlimited'||Number.isSafeInteger(cap)&&cap>=0)||q.allowed_to_extend_character_limit!==(cap!==0))throw Error('included_only_unverified')
 const remaining=q.character_limit-q.character_count
 if(remaining<includedSpeechLimits.minimumRemainingCredits)throw Error('included_margin_insufficient')
 const matching=Array.isArray(models)&&models.length<=100?models.filter(m=>m?.model_id===s.modelId):[],m=matching[0]
 if(matching.length!==1||m.can_do_text_to_speech!==true||!Number.isSafeInteger(m.maximum_text_length_per_request)||m.maximum_text_length_per_request<Array.from(s.script).length||typeof m.model_rates?.character_cost_multiplier!=='number'||!Number.isFinite(m.model_rates.character_cost_multiplier)||m.model_rates.character_cost_multiplier<=0||m.model_rates.character_cost_multiplier>4||typeof m.model_rates.cost_discount_multiplier!=='number'||!Number.isFinite(m.model_rates.cost_discount_multiplier)||m.model_rates.cost_discount_multiplier<=0||m.model_rates.cost_discount_multiplier>1||voice?.voice_id!==s.voiceId||voice.sharing?.rate!==1)throw Error('canonical_rate_unverified')
 return {remainingCredits:remaining,overageEntitled:false,observedCustomRate:1,creditEstimate:null,accountBinding:'same-captured-existing-server-key'}
}
export interface IncludedOperationStore {preflight():Promise<void>;claim(bytes:Uint8Array):Promise<void>;readClaim():Promise<Uint8Array>;providerReceipt(bytes:Uint8Array):Promise<void>;readProviderReceipt():Promise<Uint8Array>;audio(bytes:Uint8Array,sha:string):Promise<void>;readAudio(sha:string,size:number):Promise<Uint8Array>;receipt(bytes:Uint8Array):Promise<void>;readReceipt():Promise<Uint8Array>}
/** New bounded occurrence, never an old canary replay. Permanent insert-only claim
 * precedes POST. Dependencies must honor signal; outer handler owns finite deadline.
 * Included quota is not a global reservation against concurrent account consumers. */
export async function runIncludedSpeechOperation(input:IncludedSpeechOperation,d:{freshSourceScope?:FreshSpeechSourceScope;signal:AbortSignal;now():number;monotonic?():number;canon(s:IncludedSpeechOperation):Promise<void>;quota():Promise<ReturnType<typeof includedOperationQuota>>;store:IncludedOperationStore;synthesize():Promise<{requestId:string;bytes:Uint8Array}>;measureDuration(bytes:Uint8Array):Promise<number>}){
 const s=Object.freeze({...input});validateIncludedSpeechOperation(s)
 const fresh=d.freshSourceScope?structuredClone(d.freshSourceScope):undefined
 if(fresh)verifyFreshSpeechSourceScope(s,fresh)
 else if(s.key.startsWith('fresh-zaria-'))throw Error('fresh_original_snapshot_required')
 const monotonic=d.monotonic??(()=>performance.now()),start=monotonic(),active=()=>{if(d.signal.aborted||d.now()>=s.expiresAt)throw Error('authority_expired')}
 active();await d.canon(s);await d.store.preflight();const quota=await d.quota();active()
 const beforeClaim=monotonic()-start;if(!Number.isFinite(beforeClaim)||beforeClaim<0||beforeClaim>15000)throw Error('insufficient_tick_time')
 const digest=hash(JSON.stringify(s)),claim=Buffer.from(JSON.stringify({version:1,key:s.key,nonce:randomUUID(),inputDigest:digest,resource:'existing-included-only',quota,createdAt:new Date(d.now()).toISOString(),...(fresh?{freshBinding:{version:1,operation:s,sourceScope:fresh}}:{})}))
 await d.store.claim(claim);active();if(hash(await d.store.readClaim())!==hash(claim))throw Error('claim_unconfirmed')
 await d.canon(s);active()
 const elapsed=monotonic()-start;if(!Number.isFinite(elapsed)||elapsed<0||elapsed>30000)throw Error('insufficient_tick_time')
 const result=await d.synthesize();active();if(!(result.bytes instanceof Uint8Array))throw Error('audio_unconfirmed');const bytes=Uint8Array.from(result.bytes)
 if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(result.requestId)||bytes.length<12||bytes.length>includedSpeechLimits.maxBytes)throw Error('receipt_unconfirmed')
 const sha=hash(bytes)
 const observed=Buffer.from(JSON.stringify({version:1,key:s.key,inputDigest:digest,claimSha256:hash(claim),requestId:result.requestId,audioSha256:sha,audioBytes:bytes.length,durationVerified:false,qaApproved:false,publicationApproved:false}))
 await d.store.providerReceipt(observed);active();if(hash(await d.store.readProviderReceipt())!==hash(observed))throw Error('provider_receipt_unconfirmed')
 // Write exact bytes privately once. Never replace or regenerate on uncertainty.
 try{await d.store.audio(bytes,sha)}catch{/* exact readback only */}
 active();const actual=await d.store.readAudio(sha,bytes.length);if(actual.length!==bytes.length||hash(actual)!==sha)throw Error('audio_unconfirmed');active()
 const seconds=await d.measureDuration(actual);active()
 if(!Number.isFinite(seconds)||seconds<=0||seconds>s.maxDurationSeconds)throw Error('duration_unverified')
 await d.canon(s);active()
 const receipt=Buffer.from(JSON.stringify({version:1,key:s.key,inputDigest:digest,claimSha256:hash(claim),requestId:result.requestId,scriptSha256:s.scriptSha256,canonicalRevision:s.canonicalRevision,portraitSha256:s.portraitSha256,characterId:s.characterId,voiceId:s.voiceId,modelId:s.modelId,audioSha256:sha,audioBytes:bytes.length,durationSeconds:seconds,qaApproved:false,publicationApproved:false}))
 await d.store.receipt(receipt);active();if(hash(await d.store.readReceipt())!==hash(receipt))throw Error('receipt_unconfirmed')
 return {status:'private_pending_qa' as const,audioSha256:sha,audioBytes:bytes.length,durationSeconds:seconds,requestId:result.requestId,qaApproved:false,publicationApproved:false}
}
