import {createHash} from 'node:crypto'
import {validateIncludedSpeechOperation,includedSpeechLimits,type IncludedSpeechOperation,type IncludedOperationStore} from './character-production-included-speech-operation.ts'
import {measureIncludedMp3Duration} from './character-production-speech-duration.ts'
const sha=(x:string|Uint8Array)=>createHash('sha256').update(x).digest('hex')
/** Read-only full receipt chain + actual private audio bytes. No regeneration. */
export async function verifyIncludedSpeechReceipt(s:IncludedSpeechOperation,store:Pick<IncludedOperationStore,'preflight'|'readClaim'|'readProviderReceipt'|'readReceipt'|'readAudio'>,signal:AbortSignal){
 validateIncludedSpeechOperation(s)
 const active=()=>{if(signal.aborted)throw Error('cancelled')}
 active();await store.preflight();active()
 const claimBytes=await store.readClaim();active()
 const providerBytes=await store.readProviderReceipt();active()
 const receiptBytes=await store.readReceipt();active()
 if([claimBytes,providerBytes,receiptBytes].some(b=>b.length>16384))throw Error('receipt_size')
 const claim=JSON.parse(Buffer.from(claimBytes).toString()),p=JSON.parse(Buffer.from(providerBytes).toString()),r=JSON.parse(Buffer.from(receiptBytes).toString())
 const digest=sha(JSON.stringify(s)),claimHash=sha(claimBytes)
 if(claim.version!==1||claim.key!==s.key||claim.inputDigest!==digest||claim.resource!=='existing-included-only'||![p,r].every(v=>v.version===1&&v.key===s.key&&v.inputDigest===digest&&v.claimSha256===claimHash&&v.qaApproved===false&&v.publicationApproved===false))throw Error('receipt_binding_unconfirmed')
 if(typeof r.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(r.requestId)||p.requestId!==r.requestId||p.audioSha256!==r.audioSha256||p.audioBytes!==r.audioBytes||p.durationVerified!==false||!['scriptSha256','canonicalRevision','portraitSha256','characterId','voiceId','modelId'].every(k=>r[k]===s[k as keyof IncludedSpeechOperation]))throw Error('receipt_scope_unconfirmed')
 if(!/^[a-f0-9]{64}$/.test(r.audioSha256)||!Number.isSafeInteger(r.audioBytes)||r.audioBytes<12||r.audioBytes>includedSpeechLimits.maxBytes)throw Error('audio_metadata_unconfirmed')
 const audio=await store.readAudio(r.audioSha256,r.audioBytes);active()
 if(audio.length!==r.audioBytes||sha(audio)!==r.audioSha256)throw Error('audio_hash_unconfirmed')
 const duration=measureIncludedMp3Duration(audio)
 if(duration!==r.durationSeconds||duration<=0||duration>s.maxDurationSeconds)throw Error('duration_unconfirmed')
 return {status:'private_audio_receipt_verified',key:s.key,scriptSha256:s.scriptSha256,canonicalRevision:s.canonicalRevision,voiceId:s.voiceId,modelId:s.modelId,requestId:r.requestId,audioSha256:r.audioSha256,audioBytes:r.audioBytes,durationSeconds:duration,claimSha256:claimHash,receiptSha256:sha(receiptBytes),qaApproved:false,publicationApproved:false,writes:0,providerCalls:0}
}
