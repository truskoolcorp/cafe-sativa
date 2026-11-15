import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createPrivateSpeechPlayback} from '../lib/content/character-production-private-speech-playback.ts'
import {reviewedZariaSpeech as s} from '../lib/content/character-production-zaria-speech-reviewed.ts'
const sha=x=>createHash('sha256').update(x).digest('hex'),enc=x=>Buffer.from(JSON.stringify(x))
function fixture(change={}){
 const audio=Buffer.alloc(417);audio.set([255,251,144,0])
 const claim=enc({version:1,key:s.key,inputDigest:sha(JSON.stringify(s)),resource:'existing-included-only'})
 const common={version:1,key:s.key,inputDigest:sha(JSON.stringify(s)),claimSha256:sha(claim),requestId:'unit-playback',audioSha256:sha(audio),audioBytes:audio.length,qaApproved:false,publicationApproved:false}
 const receipt={...common,scriptSha256:s.scriptSha256,canonicalRevision:s.canonicalRevision,portraitSha256:s.portraitSha256,characterId:s.characterId,voiceId:s.voiceId,modelId:s.modelId,durationSeconds:1152/44100,...change}
 return {audio,store:{preflight:async()=>{},readClaim:async()=>claim,readProviderReceipt:async()=>enc({...common,durationVerified:false}),readReceipt:async()=>enc(receipt),readAudio:async()=>audio}}
}
const req=()=>new Request('https://www.cafe-sativa.com/api/admin/character-promotions/zaria-look-again-speech/audio')
function handler(f,authorize=async()=>true){let opens=0;return {run:createPrivateSpeechPlayback(s,{authorize,open:()=>{opens++;return {store:f.store,whenSettled:async()=>{}}}}),opens:()=>opens}}
test('authentication denies before storage opens',async()=>{const h=handler(fixture(),async()=>false);assert.equal((await h.run(req())).status,401);assert.equal(h.opens(),0)})
test('fixed operation rejects query, POST and cross-site reads before opening',async()=>{const h=handler(fixture());for(const r of [new Request(req().url+'?id=other'),new Request(req().url,{method:'POST'}),new Request(req().url,{headers:{'sec-fetch-site':'cross-site'}})])assert.ok((await h.run(r)).status>=400);assert.equal(h.opens(),0)})
test('verified audio returned privately with exact bytes, headers and no signed URL',async()=>{const f=fixture(),r=await handler(f).run(req());assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'audio/mpeg');assert.match(r.headers.get('Cache-Control'),/private, no-store/);assert.equal(r.headers.get('Content-Length'),'417');assert.match(r.headers.get('Content-Disposition'),/^inline;/);assert.equal(r.headers.get('Cross-Origin-Resource-Policy'),'same-origin');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),Uint8Array.from(f.audio))})
for(const [label,modify] of Object.entries({missing:f=>f.store.readReceipt=async()=>{throw Error('absent')},malformed:f=>f.store.readReceipt=async()=>Buffer.from('{'),wrongHash:f=>f.store.readAudio=async()=>Buffer.alloc(417),secondReadChanged:f=>{let n=0;f.store.readAudio=async()=>++n===1?f.audio:Buffer.alloc(417)}}))test(label+' refuses private delivery',async()=>{const f=fixture();modify(f);const r=await handler(f).run(req());assert.equal(r.status,503);assert.equal(r.headers.get('Content-Type'),'application/json')})
test('published/mismatched receipt never serves bytes',async()=>{for(const change of [{publicationApproved:true},{canonicalRevision:'f'.repeat(64)}])assert.equal((await handler(fixture(change)).run(req())).status,503)})
test('bounded late authorization never opens storage',async()=>{let open=0;const run=createPrivateSpeechPlayback(s,{authMs:5,timeoutMs:20,authorize:()=>new Promise(r=>setTimeout(()=>r(true),25)),open:()=>{open++;throw Error('must not open')}});assert.ok((await run(req())).status>=400);await new Promise(r=>setTimeout(r,35));assert.equal(open,0)})
