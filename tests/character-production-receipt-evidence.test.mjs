import test from 'node:test';import assert from 'node:assert/strict'
import {createCharacterProductionEngine} from '../lib/content/character-production-engine.ts'
import {createHeyGenProductionProvider,heyGenBindingRevision} from '../lib/content/character-production-provider-heygen.ts'
import {directHeyGenCodecs} from '../lib/content/character-production-heygen-direct.ts'
const b={characterId:'synthetic',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64),voiceId:'voice',avatarId:'avatar'}
const pc={enabled:true,linkId:'account',model:'avatar_iv',bindings:[b],mediaOrigins:['https://media.example.com'],timeoutMs:1000,maxVideoBytes:100}
const slot=()=>({key:'slot',characterId:b.characterId,script:'Synthetic',canonicalRevision:b.canonicalRevision,voiceId:b.voiceId,portraitSha256:b.portraitSha256,providerBindingRevision:heyGenBindingRevision(pc,b),provider:'heygen',model:'avatar_iv',durationSeconds:5,authorizationId:'auth',authorizationExpiresAt:Date.now()+60000,period:new Date().toISOString().slice(0,7),quoteCents:35,periodCapCents:40})
function setup({raw={data:{video_id:'original',status:'processing'}},preflight=true,support=true,failEvidence=false}={}){let job=null,posts=0,claims=0;const events=[]
const provider=createHeyGenProductionProvider(pc,{create_video_from_avatar:async()=>{posts++;return raw},get_video:async()=>{}},support?directHeyGenCodecs:{receipt:directHeyGenCodecs.receipt,status:directHeyGenCodecs.status})
const store={claim:async(s,d)=>{claims++;if(job)return null;job={key:s.key,digest:d,token:'token',state:'submitting'};return {token:'token',digest:d}},observeReceipt:async(k,t,d,id)=>{events.push(id);if(id===null)return preflight;if(failEvidence)return false;job.task=id;return true},markSubmitted:async(k,t,d,id)=>{assert.equal(job.task,id);job.state='submitted';return true},markUnknown:async()=>{job.state='unknown'}}
const engine=createCharacterProductionEngine({enabled:true,captureReceipts:true,provider:'heygen',model:'avatar_iv',characters:['synthetic'],maxVideoBytes:100,now:()=>Date.now()},()=>({provider,store,validateCurrent:async()=>true}))
return {engine,events,get job(){return job},get posts(){return posts},get claims(){return claims}}}
test('success identity persisted before qualified submission',async()=>{const x=setup();assert.equal((await x.engine.produce(slot())).status,'submitted');assert.deepEqual(x.events,[null,'original']);assert.equal(x.job.task,'original');assert.equal(x.posts,1)})
test('output qualification failure retains original identity in unknown, no retry',async()=>{const x=setup({raw:{data:{video_id:'original',status:'processing',resolution:'720p'}}});assert.equal((await x.engine.produce(slot())).status,'held');assert.equal(x.job.state,'unknown');assert.equal(x.job.task,'original');await x.engine.produce(slot());assert.equal(x.posts,1)})
test('missing provider capability blocks before claim or spend',async()=>{const x=setup({support:false});assert.equal((await x.engine.produce(slot())).status,'blocked');assert.equal(x.claims,0);assert.equal(x.posts,0)})
test('missing RPC preflight retains reservation without spend',async()=>{const x=setup({preflight:false});assert.equal((await x.engine.produce(slot())).status,'held');assert.equal(x.posts,0);assert.equal(x.job.state,'unknown')})
test('error envelopes never persist IDs and evidence failures never promote',async()=>{for(const opts of [{raw:{error:'failure',data:{video_id:'bad',status:'processing'}}},{failEvidence:true}]){const x=setup(opts);assert.equal((await x.engine.produce(slot())).status,'held');assert.equal(x.job.task,undefined);assert.equal(x.posts,1)}})
test('evidence acknowledgement arriving past deadline preserves ID but holds',async()=>{let retained;const p=createHeyGenProductionProvider({...pc,timeoutMs:5},{create_video_from_avatar:async()=>({data:{video_id:'original',status:'processing'}}),get_video:async()=>{}},directHeyGenCodecs);await assert.rejects(p.submit(slot(),async id=>{retained=id;await new Promise(r=>setTimeout(r,15))}));assert.equal(retained,'original')})
test('qualified decoder cannot substitute another observed task',async()=>{let retained;const p=createHeyGenProductionProvider(pc,{create_video_from_avatar:async()=>({}),get_video:async()=>{}},{observedReceipt:()=>({taskId:'original'}),receipt:()=>({taskId:'different'}),status:x=>x});await assert.rejects(p.submit(slot(),async id=>{retained=id}));assert.equal(retained,'original')})
test('mock end-to-end captures delayed receipt and collects original MP4 privately',async()=>{
 let job,posted=0,saved
 const s=slot(),media=Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0])
 const store={claim:async(_,digest)=>{if(job)return null;job={key:s.key,token:'token',digest,provider:'heygen',model:'avatar_iv',providerBindingRevision:s.providerBindingRevision,state:'submitting'};return {token:job.token,digest}},observeReceipt:async(k,t,d,id)=>{assert.equal(d,job.digest);if(id!==null)job.taskId=id;return true},markSubmitted:async()=>{job.state='submitted';return true},markUnknown:async()=>{job.state='unknown'},pending:async()=>job.state==='submitted'?[job]:[],markFailed:async()=>{},savePrivate:async(j,m)=>{assert.equal(j.taskId,'original');saved=m;job.state='pending_qa';return true}}
 const provider={name:'heygen',supportsReceiptCapture:true,submit:async(_,observe)=>{posted++;await new Promise(r=>setTimeout(r,15));await observe('original');return {taskId:'original'}},collect:async id=>{assert.equal(id,'original');return {state:'completed',mime:'video/mp4',bytes:media}}}
 const e=createCharacterProductionEngine({enabled:true,captureReceipts:true,provider:'heygen',model:'avatar_iv',characters:['synthetic'],maxVideoBytes:100,now:()=>Date.now()},()=>({store,provider,validateCurrent:async()=>true}))
 assert.equal((await e.produce(s)).status,'submitted');assert.equal((await e.collect()).pendingQa,1);assert.equal(job.state,'pending_qa');assert.deepEqual(saved.bytes,media);assert.match(saved.sha256,/^[a-f0-9]{64}$/);await e.produce(s);assert.equal(posted,1)
})
test('actual server RPC plus exact scope and store reaches evidence preflight with retries off',async()=>{
 const {createServerProductionRpc}=await import('../lib/content/character-production-server-rpc.ts')
 const {restrictProductionRpc}=await import('../lib/content/character-production-exact-scope.ts')
 const {createPostgresProductionStore}=await import('../lib/content/character-production-store.ts')
 const {productionSlotDigest}=await import('../lib/content/character-production-engine.ts')
 const s=slot(),digest=productionSlotDigest(s),c=new AbortController(),calls=[]
 const db={rpc(name,args){calls.push({name,args});return {abortSignal(signal){assert.equal(signal,c.signal);return {retry(enabled){assert.equal(enabled,false);return Promise.resolve({data:true,error:null})}}}}}}
 const rpc=restrictProductionRpc(createServerProductionRpc(db,c.signal),{key:s.key,digest})
 const store=createPostgresProductionStore(rpc,{}, {bucket:'character-production-private',maxVideoBytes:100})
 assert.equal(await store.observeReceipt(s.key,'token',digest,null),true)
 assert.equal(await store.observeReceipt(s.key,'token',digest,'original'),true)
 assert.deepEqual(calls.map(x=>x.name),['character_production_observe_receipt','character_production_observe_receipt'])
 await assert.rejects(store.observeReceipt('foreign','token',digest,null));assert.equal(calls.length,2)
 assert.throws(()=>createServerProductionRpc(db,c.signal).rpc('unreviewed',{}));c.abort();await assert.rejects(store.observeReceipt(s.key,'token',digest,null));assert.equal(calls.length,2)
})
