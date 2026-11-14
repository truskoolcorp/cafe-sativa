import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecurringPrivateQa} from '../lib/content/character-production-recurring-qa.ts';
const identity={key:'future-slot',digest:'a'.repeat(64)};
function fixture(opts={}){
 const calls=[],controller=new AbortController();
 const runner=createRecurringPrivateQa({enabled:()=>opts.enabled??true,limit:opts.limit,open:()=>({
  rpc:{async rpc(name,args){calls.push({name,args});if(name.endsWith('ready_slots'))return {data:opts.rows??[identity],error:opts.queueError??null};if(opts.abort)controller.abort();return {data:opts.materialize??true,error:null}}},
  bridge:{async ingest(key,digest){calls.push({name:'copy',args:{key,digest}});return {status:opts.copyStatus??'ingested'}}},
  whenSettled:opts.settle??(async()=>{}),
 })});return {runner,calls,controller};
}
test('default bounded candidate materializes exact identity then copies without paid or approval operation',async()=>{
 const f=fixture();assert.deepEqual(await f.runner.run(f.controller.signal),{status:'checked',checked:1,ingested:1,held:0});
 assert.deepEqual(f.calls,[{name:'character_production_qa_ready_slots',args:{p_limit:1}},{name:'character_production_qa_materialize',args:{p_key:identity.key,p_digest:identity.digest}},{name:'copy',args:identity}]);
});
test('disabled or pre-aborted stage opens no dependency',async()=>{for(const mode of ['disabled','abort']){const f=fixture({enabled:mode!=='disabled'});if(mode==='abort')f.controller.abort();await f.runner.run(f.controller.signal);assert.equal(f.calls.length,0)}});
test('unbound/revoked or cancelled after materialization never copies',async()=>{for(const opts of [{materialize:false},{abort:true}]){const f=fixture(opts);const r=await f.runner.run(f.controller.signal);assert.equal(r.held,1);assert.equal(f.calls.length,2)}});
test('whole malformed queue rejects before any materialization including duplicate identities',async()=>{
 for(const rows of [[identity,identity],[{...identity,target:'chosen'}],[{...identity,digest:'bad'}],[identity,{key:'other',digest:'bad'}]]){
 const f=fixture({rows,limit:5});await assert.rejects(f.runner.run(f.controller.signal));assert.equal(f.calls.length,1);
 }
});
test('copy uncertainty holds and never retries in same invocation',async()=>{const f=fixture({copyStatus:'held'});const r=await f.runner.run(f.controller.signal);assert.equal(r.held,1);assert.equal(f.calls.filter(c=>c.name==='copy').length,1)});
test('process admission remains held until original transport settlement',async()=>{
 let release;const pending=new Promise(r=>release=r);const f=fixture({settle:()=>pending});const running=f.runner.run(f.controller.signal);
 await new Promise(r=>setImmediate(r));assert.equal((await f.runner.run(f.controller.signal)).status,'busy');release();await running;
 assert.equal((await f.runner.run(f.controller.signal)).status,'checked');
});
test('queue failure is not silently reported as zero work',async()=>{const f=fixture({queueError:'unavailable'});await assert.rejects(f.runner.run(f.controller.signal));assert.equal(f.calls.length,1)});
test('collected private bytes flow through real immutable bridge without stamping approvals',async()=>{
 const {createHash}=await import('node:crypto');
 const {createCharacterProductionQaBridge}=await import('../lib/content/character-production-qa-bridge.ts');
 const bytes=Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]),sha=createHash('sha256').update(bytes).digest('hex');
 const promoId='00000000-0000-0000-0000-000000000001',calls=[];let target=false,copied=false,committed=false;
 const manifest={state:'copy',...identity,sha,bytes:16,characterId:'character',promoId,expectedUpdatedAt:'2026-11-14T20:00:00Z',sourceBucket:'character-production-private',sourcePath:`${identity.digest}/${sha}.mp4`,destinationBucket:'cafe-sativa-content',destinationPath:`character-promos/character/${promoId}/${sha}.mp4`};
 const rpc={async rpc(name,args){calls.push(name);if(name.endsWith('ready_slots'))return {data:[identity],error:null};if(name.endsWith('materialize')){target=true;return {data:true,error:null}}if(name.endsWith('prepare')){assert.equal(target,true);return {data:manifest,error:null}}if(name.endsWith('commit')){assert.equal(copied,true);assert.equal(args.p_sha,sha);committed=true;return {data:true,error:null}}throw Error('Unexpected authority') }};
 const storage={async getBucket(id){return {data:{id,public:false},error:null}},from(bucket){return {async download(){if(bucket==='cafe-sativa-content')assert.equal(copied,true);return {data:bytes,error:null}},async upload(path,data,opts){assert.equal(opts.upsert,false);assert.deepEqual(data,bytes);copied=true;return {error:null}}}}};
 const runner=createRecurringPrivateQa({enabled:()=>true,open:()=>({rpc,bridge:createCharacterProductionQaBridge(rpc,storage),whenSettled:async()=>{}})});
 assert.equal((await runner.run(new AbortController().signal)).ingested,1);assert.equal(committed,true);
 assert.deepEqual(calls,['character_production_qa_ready_slots','character_production_qa_materialize','character_production_qa_prepare','character_production_qa_commit']);
});
