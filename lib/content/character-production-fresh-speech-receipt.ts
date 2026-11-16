import {createHash} from 'node:crypto'
import {validateIncludedSpeechOperation,type IncludedSpeechOperation,type IncludedOperationStore} from './character-production-included-speech-operation'
import {verifyFreshSpeechSourceScope,type FreshSpeechSourceScope} from './character-production-fresh-speech-provenance'
import {verifyIncludedSpeechReceipt} from './character-production-speech-receipt'
type ReadStore=Pick<IncludedOperationStore,'preflight'|'readClaim'|'readProviderReceipt'|'readReceipt'|'readAudio'>
/** Read-only recovery, never synthesis/retry. Expected occurrence comes from an
 * actual persisted text attempt. Current speech permission is NOT reconstructed
 * here, and an expired original lease remains readable, never reusable to POST. */
export async function verifyFreshIncludedSpeechReceipt(expected:{key:string;textAttemptKey:string;textAttemptToken:string;textSourceDigest:string;scriptSha256:string},store:ReadStore,signal:AbortSignal){
 const e=structuredClone(expected),active=()=>signal.throwIfAborted()
 active();await store.preflight();active();const bytes=Uint8Array.from(await store.readClaim());active()
 if(bytes.length>16384)throw Error('fresh_claim_size')
 const claim=JSON.parse(Buffer.from(bytes).toString()),binding=claim.freshBinding
 if(!binding||Object.keys(binding).sort().join(',')!=='operation,sourceScope,version'||binding.version!==1)throw Error('original_fresh_snapshot_missing')
 const operation=structuredClone(binding.operation) as IncludedSpeechOperation,sourceScope=structuredClone(binding.sourceScope) as FreshSpeechSourceScope
 validateIncludedSpeechOperation(operation);verifyFreshSpeechSourceScope(operation,sourceScope)
 if(operation.key!==e.key||operation.scriptSha256!==e.scriptSha256||sourceScope.textAttemptKey!==e.textAttemptKey||sourceScope.textAttemptToken!==e.textAttemptToken||sourceScope.textSourceDigest!==e.textSourceDigest||claim.key!==e.key||claim.inputDigest!==createHash('sha256').update(JSON.stringify(operation)).digest('hex'))throw Error('original_fresh_binding_mismatch')
 // Prevent claim replacement between recovery and the existing full verifier.
 const originalHash=createHash('sha256').update(bytes).digest('hex')
 const verified=await verifyIncludedSpeechReceipt(operation,{preflight:()=>store.preflight(),readProviderReceipt:()=>store.readProviderReceipt(),readReceipt:()=>store.readReceipt(),readAudio:(sha,size)=>store.readAudio(sha,size),readClaim:async()=>{active();const current=await store.readClaim();active();if(createHash('sha256').update(current).digest('hex')!==originalHash)throw Error('fresh_claim_changed');return current}},signal)
 active();return {...verified,originalOperation:Object.freeze(operation),sourceScope:Object.freeze(sourceScope),currentAuthorityVerified:false as const}
}
