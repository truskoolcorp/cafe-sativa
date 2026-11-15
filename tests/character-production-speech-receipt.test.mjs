import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto'
import {reviewedZariaSpeech as s} from '../lib/content/character-production-zaria-speech-reviewed.ts'
import {verifyIncludedSpeechReceipt} from '../lib/content/character-production-speech-receipt.ts'
const sha=x=>createHash('sha256').update(x).digest('hex'),enc=x=>Buffer.from(JSON.stringify(x))
function fixture(change={}){
 const audio=Buffer.alloc(417);audio.set([255,251,144,0])
 const claim=enc({version:1,key:s.key,inputDigest:sha(JSON.stringify(s)),resource:'existing-included-only'})
 const common={version:1,key:s.key,inputDigest:sha(JSON.stringify(s)),claimSha256:sha(claim),requestId:'unit-fixture',audioSha256:sha(audio),audioBytes:audio.length,qaApproved:false,publicationApproved:false}
 const receipt={...common,scriptSha256:s.scriptSha256,canonicalRevision:s.canonicalRevision,portraitSha256:s.portraitSha256,characterId:s.characterId,voiceId:s.voiceId,modelId:s.modelId,durationSeconds:1152/44100,...change}
 return {preflight:async()=>{},readClaim:async()=>claim,readProviderReceipt:async()=>enc({...common,durationVerified:false}),readReceipt:async()=>enc(receipt),readAudio:async()=>audio}
}
test('readback verifies exact chain bytes and measured duration without writes',async()=>{const r=await verifyIncludedSpeechReceipt(s,fixture(),new AbortController().signal);assert.equal(r.status,'private_audio_receipt_verified');assert.equal(r.writes,0);assert.equal(r.providerCalls,0);assert.equal(r.qaApproved,false)})
for(const change of [{scriptSha256:'a'.repeat(64)},{canonicalRevision:'a'.repeat(64)},{durationSeconds:20},{audioSha256:'a'.repeat(64)},{requestId:'other'},{publicationApproved:true}])test('reject mismatched receipt '+Object.keys(change)[0],async()=>{await assert.rejects(verifyIncludedSpeechReceipt(s,fixture(change),new AbortController().signal))})
test('actual audio corruption rejected',async()=>{const f=fixture();f.readAudio=async()=>Buffer.alloc(417);await assert.rejects(verifyIncludedSpeechReceipt(s,f,new AbortController().signal))})
test('missing receipt remains unverified and never synthesizes',async()=>{const f=fixture();f.readReceipt=async()=>{throw Error('missing')};await assert.rejects(verifyIncludedSpeechReceipt(s,f,new AbortController().signal))})
