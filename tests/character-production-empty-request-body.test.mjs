import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {createRequire} from 'node:module'
import {hasEmptyRequestBody} from '../lib/content/character-production-empty-request-body.ts'
import {createSpeechProbeHandler} from '../lib/content/character-production-speech-probe-handler.ts'
import {createIncludedSpeechHandler} from '../lib/content/character-production-included-speech-handler.ts'
import {createHash} from 'node:crypto'
const require=createRequire(import.meta.url)
let adapter
try{adapter=require('next/dist/server/web/spec-extension/adapters/next-request.js')}catch{adapter=createRequire(new URL('../../ahnika-main/package.json',import.meta.url))('next/dist/server/web/spec-extension/adapters/next-request.js')}
const req=bytes=>adapter.NextRequestAdapter.fromNodeNextRequest({method:'POST',url:'https://www.cafe-sativa.com/api/admin/character-promotions/speech-storage-probe',headers:{origin:'https://www.cafe-sativa.com','content-length':String(bytes.length)},body:Readable.from(bytes.length?[bytes]:[])},new AbortController().signal)
test('installed actual Next Node adapter empty POST has nonnull stream and is accepted',async()=>{const r=req(Buffer.alloc(0));assert.notEqual(r.body,null);assert.equal(await hasEmptyRequestBody(r),true)})
test('actual Next adapter any byte including whitespace rejected',async()=>{for(const b of [Buffer.from(' '),Buffer.from('{}'),Buffer.alloc(10000)])assert.equal(await hasEmptyRequestBody(req(b)),false)})
test('stalled and aborting streams reject on finite deadline',async()=>{const r=new Request('https://www.cafe-sativa.com',{method:'POST',body:new ReadableStream({pull(){return new Promise(()=>{})}}),duplex:'half'});assert.equal(await hasEmptyRequestBody(r,5),false)})
test('actual adapter empty POST reaches probe auth and operation boundary',async()=>{let opens=0;const h=createSpeechProbeHandler({authorize:async()=>true,enabled:()=>true,attempt:()=>({id:'12345678-1234-4123-8123-123456789abc',expiresAt:new Date(Date.now()+60000).toISOString()}),open:()=>{opens++;return {run:async()=>({status:'verified'}),whenSettled:async()=>{}}}});assert.equal((await h(req(Buffer.alloc(0)))).status,200);assert.equal(opens,1);assert.equal((await h(req(Buffer.from('x')))).status,400);assert.equal(opens,1)})
test('actual adapter empty POST reaches finite speech mocked boundary only',async()=>{let opens=0;const s={key:'test-only-speech',authorizationRef:'synthetic',script:'test',scriptSha256:createHash('sha256').update('test').digest('hex'),characterId:'zaria-solenne',voiceId:'5zneNR4v1Uw5AjIZ9Un4',modelId:'eleven_v4',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64),expiresAt:Date.now()+60000,maxDurationSeconds:30};const h=createIncludedSpeechHandler(s,{origin:'https://www.cafe-sativa.com',authorize:async()=>true,enabled:()=>true,open:()=>{opens++;return {run:async()=>{},whenSettled:async()=>{}}}});assert.equal((await h(req(Buffer.alloc(0)))).status,200);assert.equal(opens,1);assert.equal((await h(req(Buffer.from('x')))).status,400);assert.equal(opens,1)})
test('aborted, disturbed and zero-chunk flood streams rejected',async()=>{
 const c=new AbortController();c.abort();assert.equal(await hasEmptyRequestBody(new Request('https://example.test',{method:'POST',signal:c.signal})),false)
 const used=req(Buffer.from('x'));await used.text();assert.equal(await hasEmptyRequestBody(used),false)
 const flood=new Request('https://example.test',{method:'POST',duplex:'half',body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(0))}})})
 assert.equal(await hasEmptyRequestBody(flood),false)
})
