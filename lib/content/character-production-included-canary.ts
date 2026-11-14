import {performance} from 'node:perf_hooks'
import {createHash,randomUUID} from 'node:crypto'
export const includedCanary=Object.freeze({key:'zaria-eleven-v4-included-canary-v1',script:"Welcome to the Gallery at Café Sativa. I'm Zaria Solenne.",voiceId:'5zneNR4v1Uw5AjIZ9Un4',modelId:'eleven_v4',maxBytes:1048576,minimumRemainingCredits:10000,format:'mp3_44100_128'})
const hash=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex')
export function includedQuotaProof(subscription:any,models:any,voice:any){
 const s=subscription,c=includedCanary
 if(!s||!Number.isSafeInteger(s.character_count)||s.character_count<0||!Number.isSafeInteger(s.character_limit)||s.character_limit<s.character_count||!['active','trialing','free'].includes(s.status)||typeof s.can_extend_character_limit!=='boolean'||typeof s.allowed_to_extend_character_limit!=='boolean')throw Error('quota_unverified')
 const cap=s.max_credit_limit_extension
 if(!(cap==='unlimited'||Number.isSafeInteger(cap)&&cap>=0))throw Error('quota_unverified')
 // Entitlement false prevents overage; cap zero independently disables it.
 // Deprecated allowed boolean must agree with explicit cap; ambiguity holds.
 if(s.allowed_to_extend_character_limit!==(cap!==0))throw Error('quota_ambiguous')
 if(s.can_extend_character_limit&&cap!==0)throw Error('overage_possible')
 const remaining=s.character_limit-s.character_count
 if(remaining<c.minimumRemainingCredits)throw Error('included_margin_insufficient')
 if(!Array.isArray(models)||models.length>100)throw Error('model_unverified')
 const matches=models.filter((m:any)=>m?.model_id===c.modelId),m=matches[0]
 if(matches.length!==1||m.can_do_text_to_speech!==true||!Number.isSafeInteger(m.maximum_text_length_per_request)||m.maximum_text_length_per_request<Array.from(c.script).length)throw Error('model_unverified')
 const rate=m.model_rates?.character_cost_multiplier,discount=m.model_rates?.cost_discount_multiplier
 if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>4||typeof discount!=='number'||!Number.isFinite(discount)||discount<=0||discount>1)throw Error('model_rate_unverified')
 if(voice?.voice_id!==c.voiceId)throw Error('voice_unverified')
 // Owner-authorized ONE fixed Bree test permits only the observed custom
 // rate1, with no overage entitlement. It is NOT a1x credit estimate.
 if(voice.sharing?.rate!==1||s.can_extend_character_limit!==false)throw Error('voice_rate_unverified')
 return {remainingCredits:remaining,modelCharacterMultiplier:rate,modelDiscountMultiplier:discount,overageEntitled:s.can_extend_character_limit,overageCap:cap,observedCustomRate:1,creditEstimate:null,accountBinding:'existing-production-server-key'}
}
export type CanaryStore={preflight():Promise<void>;claim(bytes:Uint8Array):Promise<void>;readClaim():Promise<Uint8Array>;audio(bytes:Uint8Array,sha:string):Promise<void>;readAudio(sha:string,size:number):Promise<Uint8Array>;receipt(bytes:Uint8Array):Promise<void>;readReceipt():Promise<Uint8Array>}
/** Fixed one-shot included-resource test. Claim is never released, even if no
 * provider call was reached. Not a recurring budget or global quota lock. */
export async function runIncludedCanary(d:{signal:AbortSignal;now():number;monotonic?():number;canon():Promise<void>;quota():Promise<ReturnType<typeof includedQuotaProof>>;store:CanaryStore;synthesize():Promise<{requestId:string;bytes:Uint8Array}>}){
 const monotonic=d.monotonic??(()=>performance.now()),started=monotonic()
 const active=()=>{if(d.signal.aborted)throw Error('cancelled')}
 active();await d.canon();await d.store.preflight();const first=await d.quota();active()
 const claim=Buffer.from(JSON.stringify({version:1,key:includedCanary.key,nonce:randomUUID(),inputDigest:hash(JSON.stringify(includedCanary)),resource:'existing-included-credits-only',quota:first,createdAt:new Date(d.now()).toISOString()}))
 await d.store.claim(claim);active() // A conflict or unknown is a permanent hold.
 const readClaim=await d.store.readClaim();if(hash(readClaim)!==hash(claim))throw Error('claim_unconfirmed');active()
 await d.canon();await d.quota();active()
 // Reviewed handler ends at45s: at most6s auth/body +9s preflight, then
 // reserve12s provider + five3s Storage ops +3s margin. Monotonic timing.
 // A consumed claim is never released on a late admission hold.
 const elapsed=monotonic()-started
 if(!Number.isFinite(elapsed)||elapsed<0||elapsed>9000)throw Error('insufficient_tick_time')
 const result=await d.synthesize();active()
 const bytes=result.bytes
 if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(result.requestId)||!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>includedCanary.maxBytes||(Buffer.from(bytes.subarray(0,3)).toString('ascii')!=='ID3'&&!(bytes[0]===255&&(bytes[1]&224)===224)))throw Error('speech_receipt_unconfirmed')
 const sha=hash(bytes)
 // Unknown audio write may be reconciled by exact readback, never rewritten.
 try{await d.store.audio(bytes,sha)}catch{/* readback only */}
 active();const readback=await d.store.readAudio(sha,bytes.length);if(readback.length!==bytes.length||hash(readback)!==sha)throw Error('audio_unconfirmed');active()
 const receipt=Buffer.from(JSON.stringify({version:1,key:includedCanary.key,inputDigest:hash(JSON.stringify(includedCanary)),claimSha256:hash(claim),requestId:result.requestId,audioSha256:sha,audioBytes:bytes.length,voiceId:includedCanary.voiceId,modelId:includedCanary.modelId,observedCustomRate:1,creditEstimate:null,qaApproved:false,publicationApproved:false}))
 await d.store.receipt(receipt);active();if(hash(await d.store.readReceipt())!==hash(receipt))throw Error('receipt_unconfirmed');active()
 return {status:'private_pending_qa' as const,audioSha256:sha,audioBytes:bytes.length,providerReceiptConfirmed:true,qaApproved:false,publicationApproved:false}
}
