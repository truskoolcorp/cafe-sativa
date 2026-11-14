import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {createRequire} from 'node:module'
import {createOriginalQaHandler} from '../lib/content/character-production-original-qa.ts'
import {emptyQaBody} from '../lib/content/character-production-empty-body.ts'
import {qaRequestFailure} from '../lib/content/character-production-qa-diagnostics.ts'
const require=createRequire(import.meta.url);const {NextRequestAdapter}=require('next/dist/server/web/spec-extension/adapters/next-request.js')
const url='https://cafe.test/api/admin/character-promotions/original-qa-bridge'
function handler(){let calls=0;return {h:createOriginalQaHandler({authorize:async()=>true,open:()=>({ingest:async()=>{calls++;return {status:'ingested'}},whenSettled:async()=>{}})}),calls:()=>calls}}
test('actual installed Next Node adapter wraps empty POST in nonnull stream',async()=>{
 const req=NextRequestAdapter.fromNodeNextRequest({method:'POST',url,headers:{origin:'https://cafe.test','content-length':'0'},body:Readable.from([])},new AbortController().signal)
 assert.notEqual(req.body,null);const f=handler();assert.equal((await f.h(req)).status,200);assert.equal(f.calls(),1)
})
test('all nonempty payloads refused even with misleading zero content length',async()=>{
 for(const data of ['{}',' ','x']){const f=handler();const req=new Request(url,{method:'POST',headers:{origin:'https://cafe.test','content-length':'0'},body:data});const r=await f.h(req);assert.equal(r.status,400);assert.equal((await r.json()).status,'unsupported_body');assert.equal(f.calls(),0)}
})
test('slow body times out and retains admission until cancellation settles',async()=>{
 let release;const stream=new ReadableStream({pull(){return new Promise(()=>{})},cancel(){return new Promise(r=>release=r)}})
 const f=handler();const r=await f.h(new Request(url,{method:'POST',headers:{origin:'https://cafe.test'},body:stream,duplex:'half'}));assert.equal(r.status,408);assert.equal(f.calls(),0)
 const fresh=()=>new Request(url,{method:'POST',headers:{origin:'https://cafe.test'}})
 assert.equal((await f.h(fresh())).status,429);release();await new Promise(r=>setImmediate(r));assert.equal((await f.h(fresh())).status,200)
})
test('cancelled body never reaches ingest',async()=>{const c=new AbortController();const req=new Request(url,{method:'POST',body:new ReadableStream({pull(){}}),duplex:'half'});const body=emptyQaBody(req,c.signal,20);const result=body.check();c.abort();assert.equal(await result,'unconfirmed');await body.whenSettled()})
test('UI pre-ingest status is bounded and never reflects external strings',()=>{assert.match(qaRequestFailure(405,'unsupported'),/HTTP 405; unsupported/);assert.doesNotMatch(qaRequestFailure(500,'https://secret'),/secret/);assert.match(qaRequestFailure(408,'body_unconfirmed'),/body_unconfirmed/)})
