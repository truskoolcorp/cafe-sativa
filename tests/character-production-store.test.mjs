import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPostgresProductionStore } from '../lib/content/character-production-store.ts';
import { productionSlotDigest } from '../lib/content/character-production-engine.ts';
const bytes=Uint8Array.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
const sha256=createHash('sha256').update(bytes).digest('hex');
const job={key:'slot',token:'token',digest:'a'.repeat(64),taskId:'task',provider:'test',model:'test',providerBindingRevision:'c'.repeat(64)};
const media={bytes,mime:'video/mp4',sha256};
function setup(opts={}) {
 const calls=[],uploads=[];
 const rpc={async rpc(n,a){calls.push([n,a]);if(opts.rpcError)return {data:null,error:'fail'};return {data:n.endsWith('output_status')?(opts.status??'upload'):n.endsWith('output')?true:opts.data??null,error:null};}};
 const storage={async getBucket(id){return {data:opts.noBucket?null:{id:opts.bucketId??id,public:opts.public??false},error:opts.bucketError??null};},from(id){return {async upload(path,body,config){uploads.push({id,path,body,config});return {error:opts.uploadError??null};}};}};
 return {calls,uploads,store:createPostgresProductionStore(rpc,storage,{bucket:'character-production-private',maxVideoBytes:1024})};
}
test('private immutable upload precedes exact identity CAS',async()=>{
 const x=setup();assert.equal(await x.store.savePrivate(job,media),true);
 assert.equal(x.uploads[0].path,job.digest+'/'+sha256+'.mp4');assert.deepEqual(x.uploads[0].config,{contentType:'video/mp4',upsert:false});
 assert.deepEqual(x.calls[1],[ 'character_production_output',{p_job:job,p_sha:sha256,p_bytes:16} ]);assert.notEqual(x.uploads[0].body,bytes);
});
test('bounded bytes, digest and MP4 header checked before any RPC or upload',async()=>{
 const bad=new Uint8Array(16);
 for(const m of [{...media,bytes:new Uint8Array(1025)},{...media,bytes:new Uint8Array(11)},{...media,sha256:'b'.repeat(64)},
 {...media,bytes:bad,sha256:createHash('sha256').update(bad).digest('hex')},{...media,mime:'video/webm'}]){
  const x=setup();await assert.rejects(x.store.savePrivate(job,m));assert.equal(x.calls.length,0);assert.equal(x.uploads.length,0);
 }
});
test('public, missing, mismatched or unverified bucket fails closed',async()=>{
 for(const opts of [{public:true},{noBucket:true},{bucketId:'other'},{bucketError:'error'}]){
  const x=setup(opts);await assert.rejects(x.store.savePrivate(job,media));assert.equal(x.uploads.length,0);
 }
});
test('upload conflict and uncertain receipt never commit output or retry',async()=>{
 const x=setup({uploadError:{statusCode:409}});await assert.rejects(x.store.savePrivate(job,media));assert.equal(x.calls.length,1);assert.equal(x.uploads.length,1);
});
test('identical committed output needs no upload',async()=>{const x=setup({status:'committed'});assert.equal(await x.store.savePrivate(job,media),true);assert.equal(x.uploads.length,0);});
test('held output needs no upload',async()=>{const x=setup({status:'held'});assert.equal(await x.store.savePrivate(job,media),false);assert.equal(x.uploads.length,0);});
test('pending rejects wrong scope, oversized batches and invalid limit',async()=>{
 for(const data of [[{...job,provider:'other'}],[{...job,model:'other'}],Array(6).fill(job),{},[null]]){
  const x=setup({data});await assert.rejects(x.store.pending('test','test',5));
 }
 const x=setup();await assert.rejects(x.store.pending('test','test',6));assert.equal(x.calls.length,0);
});
test('RPC error is surfaced without retry',async()=>{const x=setup({rpcError:true});await assert.rejects(x.store.markSubmitted('slot','token','a'.repeat(64),'task'));assert.equal(x.calls.length,1);});
test('configuration and malformed claim digest rejected locally',async()=>{
 assert.throws(()=>createPostgresProductionStore({}, {},{bucket:'public',maxVideoBytes:1024}));
 const x=setup();await assert.rejects(x.store.claim({},'not-hash'));assert.equal(x.calls.length,0);
});
test('durable provider binding is mandatory and SHA-256 formatted',async()=>{
 for(const revision of [undefined,'','not-hash',123]){
  const x=setup({data:[{...job,providerBindingRevision:revision}]});
  await assert.rejects(x.store.pending('test','test',5));await assert.rejects(x.store.savePrivate({...job,providerBindingRevision:revision},media));assert.equal(x.uploads.length,0);
 }
});
test('claim binds full exact slot and checks receipt rather than retrying',async()=>{
 const slot={key:'slot',characterId:'test',script:'Synthetic script',canonicalRevision:'a'.repeat(64),voiceId:'voice',portraitSha256:'b'.repeat(64),provider:'test',model:'test',durationSeconds:10,authorizationId:'auth',authorizationExpiresAt:Date.now()+60000,period:'2026-11',quoteCents:25,periodCapCents:50,providerBindingRevision:'c'.repeat(64)};
 const digest=productionSlotDigest(slot);
 const x=setup({data:{token:'token',digest}});assert.deepEqual(await x.store.claim(slot,digest),{token:'token',digest});assert.deepEqual(x.calls[0][1],{p_slot:slot,p_digest:digest});
 const y=setup({data:{token:'token',digest:'d'.repeat(64)}});await assert.rejects(y.store.claim(slot,digest));assert.equal(y.calls.length,1);
 const z=setup();assert.equal(await z.store.claim(slot,digest),null);
});
// Static guards only: these do not establish PostgreSQL transaction semantics.
const sql=readFileSync(new URL('../docs/proposals/character-production-store.sql',import.meta.url),'utf8');
test('proposal checks expiry/month after budget lock before reservation and rejects nulls',()=>{
 const claim=sql.split('CREATE FUNCTION public.character_production_claim(')[1].split('CREATE FUNCTION public.character_production_submitted(')[0];
 const lock=claim.indexOf("period=a.slot->>'period' FOR UPDATE;");
 const expiry=claim.indexOf("(a.slot->>'authorizationExpiresAt')::numeric <= extract(epoch FROM clock_timestamp())*1000");
 const month=claim.indexOf("a.slot->>'period' IS DISTINCT FROM to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')");
 assert.ok(lock>=0&&expiry>lock&&month>expiry&&claim.indexOf('INSERT INTO character_production.jobs')>month);
 assert.match(claim,/authorizationExpiresAt' IS NULL/);assert.match(claim,/b.cap_cents IS DISTINCT FROM/);
 assert.match(claim,/a.slot IS DISTINCT FROM p_slot/);assert.match(claim,/cost IS NULL OR cost<=0/);
});
test('proposal captures immutable original slot in same claim insert',()=>{
 const jobs=sql.split('CREATE TABLE character_production.jobs (')[1].split('ALTER TABLE')[0];
 assert.match(jobs,/slot jsonb NOT NULL CHECK\(jsonb_typeof\(slot\)='object' AND \(slot->>'key'\) IS NOT DISTINCT FROM key\)/);
 assert.match(sql,/INSERT INTO character_production.jobs\(key,digest,provider,model,period,cost,provider_binding_revision,slot\)/);
 assert.match(sql,/VALUES\(a.key,a.digest,b.provider,a.slot->>'model',b.period,cost,a.slot->>'providerBindingRevision',a.slot\)/);
 const updates=sql.match(/UPDATE character_production\.jobs SET[\s\S]*?;/g)??[];
 assert.ok(updates.length>=4);for(const u of updates)assert.doesNotMatch(u.split('WHERE')[0],/\bslot\s*=/);
});
test('proposal never reclaims keys or reservations and revokes standard role grants',()=>{
 assert.match(sql,/UNIQUE\(provider,task\)/);assert.match(sql,/ON CONFLICT\(key\) DO NOTHING/);
 assert.doesNotMatch(sql,/DELETE\s+FROM/i);assert.doesNotMatch(sql,/reserved_cents\s*=\s*reserved_cents\s*-/);
 assert.match(sql,/ARRAY\['anon','authenticated','service_role'\]/);
 assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA character_production FROM PUBLIC/);
 for(const name of ['authorization','claim','submitted','unknown','pending','failed','output_status','output'])assert.match(sql,new RegExp('REVOKE ALL ON FUNCTION public.character_production_'+name+'\\('));
});
