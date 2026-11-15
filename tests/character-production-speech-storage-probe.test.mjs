import test from 'node:test';import assert from 'node:assert/strict'
import {probeSpeechClaimStorage} from '../lib/content/character-production-speech-storage-probe.ts'
function fixture(change={}){
 let stored;const calls=[]
 const sdk={
  getBucket:async()=>({data:{id:'cafe-sativa-characters',public:!!change.public,file_size_limit:10485760,allowed_mime_types:['application/json','image/jpeg','image/png','image/webp']},error:null}),
  from:bucket=>({
   upload:async(path,bytes,options)=>{calls.push({bucket,path,options});if(change.error)return {error:{statusCode:500},data:null};if(stored&&!change.overwrite)return {error:change.duplicate??{status:409,statusCode:'ResourceAlreadyExists',message:'The resource already exists'},data:null};stored=bytes;return {data:{path},error:null}},
   download:()=>({asStream:async()=>({data:new ReadableStream({start(c){c.enqueue(change.corrupt?Buffer.from('wrong'):stored);c.close()}}),error:null})})
  })
 }
 return {sdk,calls}
}
test('two contenders yield one explicit409 and exact private winner',async()=>{const f=fixture(),r=await probeSpeechClaimStorage(f.sdk,new AbortController().signal,'12345678-1234-4123-8123-123456789abc');assert.equal(r.status,'verified');assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.options.upsert===false));assert.equal(f.calls[0].path,f.calls[1].path);assert.match(r.path,/^production-speech-operations\/storage-probe-[a-f0-9-]+\/claim.json$/);assert.equal(r.providerCalls,0)})
for(const [label,change] of [['overwrite',{overwrite:true}],['generic error',{error:true}],['readback corruption',{corrupt:true}]])test(`${label} is not success and never retries`,async()=>{const f=fixture(change),r=await probeSpeechClaimStorage(f.sdk,new AbortController().signal,'12345678-1234-4123-8123-123456789abc');assert.equal(r.status,'unverified');assert.equal(r.retry,false);assert.equal(f.calls.length,2)})
test('public bucket blocks all writes',async()=>{const f=fixture({public:true});await assert.rejects(probeSpeechClaimStorage(f.sdk,new AbortController().signal,'12345678-1234-4123-8123-123456789abc'));assert.equal(f.calls.length,0)})
test('aborted probe performs no calls',async()=>{const f=fixture(),c=new AbortController();c.abort();await assert.rejects(probeSpeechClaimStorage(f.sdk,c.signal,'12345678-1234-4123-8123-123456789abc'));assert.equal(f.calls.length,0)})
test('repeated same configured attempt cannot create new marker or success',async()=>{
 const f=fixture(),id='12345678-1234-4123-8123-123456789abc'
 assert.equal((await probeSpeechClaimStorage(f.sdk,new AbortController().signal,id)).status,'verified')
 assert.equal((await probeSpeechClaimStorage(f.sdk,new AbortController().signal,id)).status,'unverified')
 assert.equal(new Set(f.calls.map(c=>c.path)).size,1)
})
test('separate concurrent instances share one durable attempt key',async()=>{
 const f=fixture(),id='12345678-1234-4123-8123-123456789abc'
 const results=await Promise.all([0,1].map(()=>probeSpeechClaimStorage(f.sdk,new AbortController().signal,id)))
 assert.equal(results.filter(r=>r.status==='verified').length,1);assert.equal(new Set(f.calls.map(c=>c.path)).size,1)
})

for(const duplicate of [{status:400,statusCode:'400',message:'Asset Already Exists'},{status:409,statusCode:'409',message:'The resource already exists'},{status:409,statusCode:'ResourceAlreadyExists',message:'Conflict'}])test('known duplicate shape '+JSON.stringify(duplicate),async()=>{
 const f=fixture({duplicate});assert.equal((await probeSpeechClaimStorage(f.sdk,new AbortController().signal,'12345678-1234-4123-8123-123456789abc')).status,'verified')
})
for(const duplicate of [{status:400,message:'Bad request'},{status:409,message:'Conflict'},{statusCode:'409'},{status:400,statusCode:'ResourceAlreadyExists',message:'Other'}])test('generic conflict rejected '+JSON.stringify(duplicate),async()=>{
 const f=fixture({duplicate});assert.equal((await probeSpeechClaimStorage(f.sdk,new AbortController().signal,'12345678-1234-4123-8123-123456789abc')).status,'unverified')
})
