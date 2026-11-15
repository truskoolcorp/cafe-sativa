import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs'
import {createSpeechProbeHandler} from '../lib/content/character-production-speech-probe-handler.ts'
function fixture(authorized=true,enabled=true){const calls=[];return {calls,h:createSpeechProbeHandler({authorize:async()=>authorized,enabled:()=>enabled,attempt:()=>({id:'12345678-1234-4123-8123-123456789abc',expiresAt:new Date(Date.now()+60000).toISOString()}),open:(mode,signal)=>{calls.push(mode);return {run:async()=>({status:'verified',synthesisAttempted:false}),whenSettled:async()=>{}}}})}}
const req=(method='POST',extra={})=>new Request('https://www.cafe-sativa.com/api/admin/character-promotions/speech-storage-probe',{method,...(method==='POST'?{headers:{origin:'https://www.cafe-sativa.com'}}:{}),...extra})
test('bad auth opens no storage/canon',async()=>{const f=fixture(false);assert.equal((await f.h(req())).status,401);assert.equal(f.calls.length,0)})
test('disabled POST opens no storage but GET remains read-only',async()=>{const f=fixture(true,false);assert.equal((await f.h(req())).status,503);assert.equal((await f.h(req('GET'))).status,200);assert.deepEqual(f.calls,['canon'])})
test('body and cross-origin rejected',async()=>{const f=fixture();assert.equal((await f.h(req('POST',{body:'x'}))).status,400);assert.equal((await f.h(req('POST',{headers:{origin:'https://evil.test'}}))).status,400);assert.equal(f.calls.length,0)})
test('authorized POST is only provider-free probe',async()=>{const f=fixture();const r=await f.h(req());assert.equal(r.status,200);assert.deepEqual(f.calls,['probe']);assert.equal((await r.json()).synthesisAttempted,false)})
test('route exposes only protected helper and server opens no provider',()=>{const route=readFileSync(new URL('../app/api/admin/character-promotions/speech-storage-probe/route.ts',import.meta.url),'utf8'),server=readFileSync(new URL('../lib/content/character-production-speech-storage-probe-server.ts',import.meta.url),'utf8');assert.match(route,/POST=runAuthorizedSpeechStorageProbe/);assert.match(server,/authorize:isContentAdmin/);assert.match(server,/normalizePromoCanon/);assert.doesNotMatch(server,/ELEVENLABS_API_KEY|createIncludedOperationProvider|synthesize\(/)})
const attempt=()=>({id:'12345678-1234-4123-8123-123456789abc',expiresAt:new Date(Date.now()+60000).toISOString()})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
test('missing malformed and expired configured attempt open nothing',async()=>{
 for(const value of [undefined,{id:'x',expiresAt:new Date(Date.now()+60000).toISOString()},{id:attempt().id,expiresAt:'no'},{id:attempt().id,expiresAt:new Date(0).toISOString()}]){
 let opens=0;const h=createSpeechProbeHandler({authorize:async()=>true,enabled:()=>true,attempt:()=>value,open:()=>{opens++;throw Error()}})
 assert.equal((await h(req())).status,503);assert.equal(opens,0)
 }
})
test('late successful auth after timeout cannot open dependencies',async()=>{
 let resolve,opens=0;const h=createSpeechProbeHandler({authorize:()=>new Promise(r=>resolve=r),enabled:()=>true,attempt,authMs:5,totalMs:100,open:()=>{opens++;throw Error()}})
 assert.equal((await h(req())).status,401);resolve(true);await wait(10);assert.equal(opens,0)
})
test('parallel request rejected and timeout holds busy until settlement',async()=>{
 let finish,settle,seen;const h=createSpeechProbeHandler({authorize:async()=>true,enabled:()=>true,attempt,totalMs:10,open:(_m,s,a)=>{seen={s,a};return {run:()=>new Promise(r=>finish=r),whenSettled:()=>new Promise(r=>settle=r),reconciliation:()=>({bucket:'cafe-sativa-characters',path:'known'})}}})
 const first=h(req());await wait(1);assert.equal((await h(req())).status,429)
 const response=await first;assert.equal(response.status,503);assert.equal((await response.json()).reconciliation.path,'known');assert.equal(seen.s.aborted,true)
 assert.equal((await h(req())).status,429);finish({});await wait(1);assert.equal((await h(req())).status,429);settle();await wait(1)
 assert.equal(seen.a.id,attempt().id)
})
test('finite attempt expiry during delayed auth never opens',async()=>{
 let opens=0;const h=createSpeechProbeHandler({authorize:async()=>{await wait(30);return true},enabled:()=>true,attempt:()=>({...attempt(),expiresAt:new Date(Date.now()+5).toISOString()}),authMs:100,totalMs:100,open:()=>{opens++;throw Error()}})
 assert.equal((await h(req())).status,503);await wait(40);assert.equal(opens,0)
})
