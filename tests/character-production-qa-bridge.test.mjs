import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createCharacterProductionQaBridge,createCharacterProductionQaRunner} from '../lib/content/character-production-qa-bridge.ts';
const bytes=Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
const sha=createHash('sha256').update(bytes).digest('hex'),digest='a'.repeat(64),promoId='00000000-0000-0000-0000-000000000001';
const manifest={state:'copy',key:'job',digest,sha,bytes:16,characterId:'character',promoId,expectedUpdatedAt:'2026-11-11T01:00:00.123456Z',sourceBucket:'character-production-private',sourcePath:`${digest}/${sha}.mp4`,destinationBucket:'cafe-sativa-content',destinationPath:`character-promos/character/${promoId}/${sha}.mp4`};
const sql=readFileSync(new URL('../docs/proposals/character-production-qa-bridge.sql',import.meta.url),'utf8');
function fixture(opts={}){
 const calls=[],uploads=[],reads=[],buckets=[];
 const rpc={async rpc(name,args){calls.push({name,args});return {data:name.endsWith('prepare')?opts.held?null:{...manifest,...opts.manifest}:opts.commit??true,error:opts.rpcError??null}}};
 const storage={async getBucket(id){buckets.push(id);return {data:{id,public:opts.public??false},error:null}},from(id){return {
 async download(path,max){reads.push({id,path,max});return {data:opts.badSource&&id===manifest.sourceBucket||opts.badDestination&&id===manifest.destinationBucket?new Uint8Array(16):bytes,error:null}},
 async upload(path,body,config){uploads.push({id,path,body,config});if(opts.throwUpload)throw Error('lost');return {error:opts.conflict?{statusCode:409}:null}}
 }}};
 return {bridge:createCharacterProductionQaBridge(rpc,storage),calls,uploads,reads,buckets};
}
test('immutable private copy readback commits only exact prepared identity',async()=>{
 const f=fixture();assert.deepEqual(await f.bridge.ingest('job',digest),{status:'ingested'});
 assert.deepEqual(f.calls[0].args,{p_key:'job',p_digest:digest});
 assert.deepEqual(f.calls[1].args,{p_key:'job',p_digest:digest,p_sha:sha,p_bytes:16,p_promo_id:promoId,p_expected_updated_at:manifest.expectedUpdatedAt,p_destination_bucket:manifest.destinationBucket,p_destination_path:manifest.destinationPath});
 assert.equal(f.uploads[0].config.upsert,false);assert.notEqual(f.uploads[0].body,bytes);
 assert.equal(f.reads.length,2);assert.equal(f.reads[1].max,35*1024*1024);assert.equal(f.buckets.length,4);
});
test('unregistered stale or disabled targets hold without objects',async()=>{const f=fixture({held:true});assert.deepEqual(await f.bridge.ingest('job',digest),{status:'held'});assert.equal(f.reads.length,0)});
test('malformed or arbitrary target manifest fails before copy',async()=>{
 for(const patch of [{sourceBucket:'public'},{destinationBucket:'public'},{sourcePath:'other'},{destinationPath:'other'},{characterId:'../other'},{promoId:'bad'},{digest:'b'.repeat(64)},{bytes:15},{bytes:35*1024*1024+1},{expectedUpdatedAt:'invalid'}]){
 const f=fixture({manifest:patch});await assert.rejects(f.bridge.ingest('job',digest));assert.equal(f.uploads.length,0);assert.equal(f.calls.length,1);
 }
});
test('public bucket or wrong source bytes prevents upload',async()=>{for(const opts of [{public:true},{badSource:true}]){const f=fixture(opts);await assert.rejects(f.bridge.ingest('job',digest));assert.equal(f.uploads.length,0)}});
test('destination mismatch prevents commit even after upload success',async()=>{const f=fixture({badDestination:true});await assert.rejects(f.bridge.ingest('job',digest));assert.equal(f.calls.length,1)});
test('conflict or uncertain upload reconciles only exact destination bytes',async()=>{
 for(const opts of [{conflict:true},{throwUpload:true}]){const f=fixture(opts);assert.equal((await f.bridge.ingest('job',digest)).status,'ingested');assert.equal(f.uploads.length,1)}
 const f=fixture({conflict:true,badDestination:true});await assert.rejects(f.bridge.ingest('job',digest));assert.equal(f.calls.length,1);
});
test('idempotent committed receipt rechecks private destination without upload',async()=>{const f=fixture({manifest:{state:'committed'}});assert.equal((await f.bridge.ingest('job',digest)).status,'ingested');assert.equal(f.uploads.length,0);assert.equal(f.reads.length,1);assert.equal(f.calls.length,1)});
test('stale commit holds without retry or overwriting media',async()=>{const f=fixture({commit:false});assert.equal((await f.bridge.ingest('job',digest)).status,'held');assert.equal(f.calls.length,2);assert.equal(f.uploads.length,1)});
test('RPC failures and malformed generation identity cannot initiate copy',async()=>{const f=fixture({rpcError:'failed'});await assert.rejects(f.bridge.ingest('job',digest));assert.equal(f.calls.length,1);assert.equal(f.uploads.length,0);await assert.rejects(f.bridge.ingest('job','bad'));assert.equal(f.calls.length,1)});
test('SQL static guard: locked target, current authority, untouched approvals',()=>{
 for(const guard of ["current_setting('transaction_isolation') IS DISTINCT FROM 'read committed'",'a.digest IS DISTINCT FROM p_digest','j.digest IS DISTINCT FROM a.digest','a.slot IS DISTINCT FROM j.slot','d.character_id IS DISTINCT FROM j.slot','d.spoken_script IS DISTINCT FROM j.slot','d.updated_at IS DISTINCT FROM t.expected_updated_at','d.video_asset_path IS NOT NULL','d.audio_asset_path IS NOT NULL','d.voice_approved_at IS NOT NULL','d.video_qa_approved_at IS NOT NULL','d.publication_approved_at IS NOT NULL'])assert.ok(sql.includes(guard),guard);
 assert.match(sql,/qa_targets WHERE job_key=j.key FOR UPDATE/);assert.match(sql,/cs_character_promo_drafts WHERE id=t.promo_id FOR UPDATE/);
 assert.match(sql,/SET video_asset_path=m->>'destinationPath',updated_at=clock_timestamp\(\)/);
 assert.doesNotMatch(sql,/\bGRANT\b|INSERT INTO .*qa_pass|SET voice_approved_at|SET video_qa_approved_at|SET publication_approved_at/);
 assert.match(sql,/m:=character_production.qa_manifest\(p_key,p_digest\)/);
});
test('commit preserves prepared timestamp microseconds and binds each target field',async()=>{
 const f=fixture();await f.bridge.ingest('job',digest);assert.equal(f.calls[1].args.p_expected_updated_at,'2026-11-11T01:00:00.123456Z');
 for(const check of ["(m->>'promoId')::uuid IS DISTINCT FROM p_promo_id","(m->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM p_expected_updated_at","m->>'destinationBucket' IS DISTINCT FROM p_destination_bucket","m->>'destinationPath' IS DISTINCT FROM p_destination_path"])assert.ok(sql.includes(check),check);
});
test('target changes after readback are held rather than attach another destination',async()=>{
 for(const changed of [{promoId:'00000000-0000-0000-0000-000000000002'},{expectedUpdatedAt:'2026-11-11T01:00:00.123457Z'},{destinationBucket:'other'},{destinationPath:'other'}]){
 let current={...manifest},commits=0;
 const rpc={async rpc(name,args){if(name.endsWith('prepare'))return {data:{...manifest},error:null};commits++;return {data:args.p_promo_id===current.promoId&&args.p_expected_updated_at===current.expectedUpdatedAt&&args.p_destination_bucket===current.destinationBucket&&args.p_destination_path===current.destinationPath,error:null}}};
 const storage={async getBucket(id){return {data:{id,public:false},error:null}},from(id){return {async upload(){return {error:null}},async download(){if(id===manifest.destinationBucket)current={...current,...changed};return {data:bytes,error:null}}}}};
 assert.equal((await createCharacterProductionQaBridge(rpc,storage).ingest('job',digest)).status,'held');assert.equal(commits,1);
 }
});
test('SQL rejects changed full slot even if current policy retains old digest',()=>{
 assert.ok(sql.includes('a.slot IS DISTINCT FROM j.slot'));assert.ok(sql.includes("d.spoken_script IS DISTINCT FROM j.slot->>'script'"));assert.doesNotMatch(sql,/d\.(character_id|spoken_script) IS DISTINCT FROM a\.slot/);
});
function runnerFixture(rows,fail=[]){
 const calls=[],ingests=[];
 const rpc={async rpc(name,args){calls.push({name,args});return {data:rows,error:null}}};
 const bridge={async ingest(key,digest){ingests.push({key,digest});if(fail.includes(key))throw Error('held');return {status:'ingested'}}};
 return {runner:createCharacterProductionQaRunner(true,()=>({rpc,bridge})),calls,ingests};
}
test('runner defaults off without opening any clients',async()=>{
 assert.deepEqual(await createCharacterProductionQaRunner().run(),{status:'disabled',checked:0,ingested:0,held:0});let opened=0;await createCharacterProductionQaRunner(false,()=>{opened++;throw Error('unexpected')}).run();assert.equal(opened,0);
});
test('runner bounds queue request to five and deduplicates identical jobs',async()=>{
 const f=runnerFixture([{key:'job',digest},{key:'job',digest}]);assert.deepEqual(await f.runner.run(),{status:'checked',checked:1,ingested:1,held:0});assert.deepEqual(f.calls,[{name:'character_production_qa_pending',args:{p_limit:5}}]);assert.equal(f.ingests.length,1);
});
test('runner rejects entire oversized malformed conflicting batch before ingest',async()=>{
 for(const rows of [Array(6).fill({key:'job',digest}),[{key:'job',digest},{key:'bad',digest:'bad'}],[{key:'job',digest,url:'private'}],[{key:'job',digest},{key:'job',digest:'b'.repeat(64)}],null]){const f=runnerFixture(rows);await assert.rejects(f.runner.run());assert.equal(f.ingests.length,0)}
});
test('one failed ingestion does not starve remaining items or initiate rendering',async()=>{
 const f=runnerFixture([{key:'first',digest},{key:'second',digest}],['first']);assert.deepEqual(await f.runner.run(),{status:'checked',checked:2,ingested:1,held:1});assert.deepEqual(f.ingests.map(x=>x.key),['first','second']);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'character_production_qa_pending');
});
test('SQL queue includes only enrolled exact current unreceipted pending jobs',()=>{
 const pending=sql.split('CREATE FUNCTION public.character_production_qa_pending(')[1].split('REVOKE ALL ON FUNCTION')[0];
 for(const guard of ["jsonb_build_object('key',j.key,'digest',j.digest)",'t.digest=j.digest AND t.enabled=true','a.digest=j.digest AND a.slot=j.slot AND a.enabled=true',"j.state='pending_qa'",'NOT EXISTS','least(coalesce(p_limit,0),5)'])assert.ok(pending.includes(guard),guard);
 assert.doesNotMatch(pending,/INSERT|UPDATE|url|object_path/i);assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.character_production_qa_pending(integer) FROM PUBLIC'));
});
