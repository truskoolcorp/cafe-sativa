import test from 'node:test'
import assert from 'node:assert/strict'
import {createEnrolledQaEntry} from '../lib/content/character-production-enrolled-qa-entry.ts'
const id='66666666-6666-4666-8666-666666666666',scope={key:'owned',digest:'a'.repeat(64)}
const request=()=>new Request('https://example.test/internal',{headers:{authorization:'ok'}})
function harness(response,options={}){
 const calls=[];let opened=0
 const entry=createEnrolledQaEntry(id,[scope],{enabled:()=>true,authorize:h=>h==='ok',...options,open(signal){opened++;return {db:{rpc(name,args){calls.push([name,args]);return {abortSignal(s){assert.equal(s,signal);return {retry(r){assert.equal(r,false);return response(name,args)}}}}}},storage:{},whenSettled:async()=>{}}}})
 return {entry,calls,opened:()=>opened}
}
test('bad auth, method, disabled and cancelled open nothing',async()=>{
 for(const [req,options,status] of [[new Request('https://example.test'),{},401],[new Request('https://example.test',{method:'POST',headers:{authorization:'ok'}}),{},405],[request(),{enabled:()=>false},503],[new Request('https://example.test',{signal:AbortSignal.abort(),headers:{authorization:'ok'}}),{},503]]){
 const h=harness(()=>{throw Error('unexpected')},options);assert.equal((await h.entry(req)).status,status);assert.equal(h.opened(),0)
 }
})
test('actual enrolled adapter routes empty discovery without write',async()=>{
 const h=harness(async()=>({data:[],error:null}));assert.equal((await h.entry(request())).status,200)
 assert.deepEqual(h.calls,[['character_production_scheduler_qa_ready',{p_enrollment:id,p_limit:1}]])
})
test('null or foreign discovery holds without writes',async()=>{
 for(const data of [null,[{...scope,key:'foreign'}]]){const h=harness(async()=>({data,error:null}));assert.equal((await h.entry(request())).status,503);assert.equal(h.calls.length,1)}
})
test('materialize false stops before private copy or commit',async()=>{
 const h=harness(async n=>({data:n.endsWith('qa_ready')?[scope]:false,error:null}));assert.equal((await h.entry(request())).status,503);assert.deepEqual(h.calls.map(c=>c[0]),['character_production_scheduler_qa_ready','character_production_qa_materialize'])
})
test('parallel request cannot duplicate writes, timeout holds latch until settlement',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>{resolve=r}),{timeoutMs:10});const first=h.entry(request());assert.equal((await h.entry(request())).status,429);assert.equal((await first).status,503);assert.equal((await h.entry(request())).status,429);resolve({data:[],error:null});await new Promise(r=>setTimeout(r,0));assert.equal(h.calls.length,1)
})
test('exact materialized job flows through real private bridge once, never approval',async()=>{
 const {createHash}=await import('node:crypto');const bytes=Uint8Array.from(Buffer.from('0000ftyp0000000000000000'));const sha=createHash('sha256').update(bytes).digest('hex')
 const calls=[],writes=[];const promoId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const manifest={state:'copy',...scope,sha,bytes:bytes.length,characterId:'zaria',promoId,expectedUpdatedAt:'2026-11-15T01:00:00.000Z',sourceBucket:'character-production-private',sourcePath:`${scope.digest}/${sha}.mp4`,destinationBucket:'cafe-sativa-content',destinationPath:`character-promos/zaria/${promoId}/${sha}.mp4`}
 const entry=createEnrolledQaEntry(id,[scope],{enabled:()=>true,authorize:()=>true,open:()=>({db:{rpc(n,a){calls.push(n);return {abortSignal(){return {retry(){return Promise.resolve({error:null,data:n.endsWith('qa_ready')?[scope]:n.endsWith('prepare')?manifest:true})}}}}}},storage:{getBucket:async id=>({data:{id,public:false},error:null}),from:id=>({download:async()=>({data:bytes,error:null}),upload:async(path,b,options)=>{writes.push({id,path,options});return {error:null}}})},whenSettled:async()=>{}})})
 assert.equal((await (await entry(request())).json()).status,'ingested')
 assert.deepEqual(calls,['character_production_scheduler_qa_ready','character_production_qa_materialize','character_production_qa_prepare','character_production_qa_commit']);assert.equal(writes.length,1);assert.equal(writes[0].options.upsert,false)
})
