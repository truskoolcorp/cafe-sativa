import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createStreamingQaStorage} from '../lib/content/character-production-qa-storage.ts';
const require=createRequire(import.meta.url);
const {StorageClient}=require('@supabase/storage-js');
const source='a'.repeat(64)+'/'+'b'.repeat(64)+'.mp4';
const target='character-promos/synthetic/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/'+'b'.repeat(64)+'.mp4';
const bytes=Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
test('installed SDK stream forwards no-store abort and redirect:error',async()=>{
 const calls=[];const sdk=new StorageClient('https://synthetic.example/storage/v1',{},async(url,options)=>{calls.push({url,options});return new Response(bytes,{status:200})});
 const r=await createStreamingQaStorage(sdk).from('character-production-private').download(source,1024);
 assert.deepEqual(r.data,bytes);assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');assert.ok(calls[0].options.signal instanceof AbortSignal);assert.equal(calls[0].url,'https://synthetic.example/storage/v1/object/character-production-private/'+source);
});
test('overflow stream cancels before unbounded buffering',async()=>{
 let cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(100))},cancel(){cancelled=true}});
 const sdk=new StorageClient('https://synthetic.example/storage/v1',{},async()=>new Response(stream));
 await assert.rejects(createStreamingQaStorage(sdk).from('character-production-private').download(source,16),/byte cap/);assert.equal(cancelled,true);
});
test('stalled stream absolute deadline cancels reader',async()=>{
 let cancelled=false;const sdk=new StorageClient('https://synthetic.example/storage/v1',{},async()=>new Response(new ReadableStream({cancel(){cancelled=true}})));
 await assert.rejects(createStreamingQaStorage(sdk,5).from('character-production-private').download(source,1024),/unconfirmed|Private stream unavailable/);assert.equal(cancelled,true);
});
test('unexpected bucket or path is rejected before SDK calls',async()=>{
 let calls=0;const sdk={from(){calls++;throw Error('No')},getBucket(){calls++;throw Error('No')}};const s=createStreamingQaStorage(sdk);
 assert.throws(()=>s.from('public'));await assert.rejects(s.from('character-production-private').download('../secret',100));assert.throws(()=>s.from('character-production-private').upload(source,bytes,{contentType:'video/mp4',upsert:false}));assert.equal(calls,0);
});
test('installed SDK upload is immutable single attempt without URL signing',async()=>{
 const calls=[];const sdk=new StorageClient('https://synthetic.example/storage/v1',{},async(url,options)=>{calls.push({url,options});return Response.json({Id:'synthetic',Key:'synthetic'})});
 await createStreamingQaStorage(sdk).from('cafe-sativa-content').upload(target,bytes,{contentType:'video/mp4',upsert:false});
 assert.equal(calls.length,1);assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.headers['x-upsert'],'false');assert.ok(!calls[0].url.includes('sign'));
});
test('missing streaming capability fails instead of requesting unbounded Blob',async()=>{
 const sdk={from(){return {download(){return {then(){throw Error('Blob must not load')}}}}}};
 await assert.rejects(createStreamingQaStorage(sdk).from('character-production-private').download(source,1024),/Streaming/);
});
test('late response ignoring abort has stream cancelled after timeout',async()=>{
 let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true}});
 const sdk=new StorageClient('https://synthetic.example/storage/v1',{},async()=>{await new Promise(r=>setTimeout(r,20));return new Response(stream)});
 await assert.rejects(createStreamingQaStorage(sdk,5).from('character-production-private').download(source,1024));await new Promise(r=>setTimeout(r,30));assert.equal(cancelled,true);
});
