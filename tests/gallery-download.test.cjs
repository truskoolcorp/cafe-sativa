const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto')
const source=ts.transpileModule(fs.readFileSync('app/api/gallery/download/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const id='12345678-1234-1234-1234-123456789abc',product='p',edition='a'
const bytes=Buffer.from('synthetic approved artwork'),sha256=crypto.createHash('sha256').update(bytes).digest('hex')
function setup({preview=false,user='buyer',owner='buyer',state='delivered',revoked=false,refundDuringRead=false,assetMissing=false,wrongProduct=false,bucketPublic=false,bucketMissing=false,bucketWrongId=false,bucketChanges=false,corrupt=false,missing=false,mappingChanges=false,editionChanges=false,large=false}={}){
 let reads=0,db=0
 const payload=large?Buffer.alloc(5*1024*1024,42):bytes,digest=crypto.createHash('sha256').update(payload).digest('hex')
 const env={VERCEL_ENV:preview?'preview':'production',GALLERY_PRIVATE_DOWNLOADS:'true'}
 const rows=()=>({orders:{id,user_id:owner,paid_at:'now',fulfillment_state:state,order_items:[{product_id:product,products:{kind:'digital'}}]},gallery_private_deliveries:{order_id:id,product_id:product,object_path:id+'/'+(mappingChanges&&reads?'different':edition),approved_asset_id:assetMissing?null:edition},gallery_approved_assets:{id:edition,product_id:wrongProduct?'other':product,revoked_at:revoked?'now':null,sha256:editionChanges&&reads?'0'.repeat(64):digest}})
 const admin={from(table){db++;let filters=[];return {select(){return this},eq(k,v){filters.push(r=>r[k]===v);return this},is(k,v){filters.push(r=>r[k]===v);return this},not(k,op,v){filters.push(r=>r[k]!==v);return this},maybeSingle:async()=>{const row=rows()[table];return {data:filters.every(f=>f(row))?row:null}}}},storage:{getBucket:async()=>({error:bucketMissing?Error('missing'):null,data:{id:bucketWrongId?'other':'gallery-private',public:bucketPublic||(bucketChanges&&reads>0)}}),from(bucket){assert.equal(bucket,'gallery-private');return {download:async(path)=>{reads++;assert.equal(path,id+'/'+edition);if(refundDuringRead)state='refunded';if(missing)return {error:Error('missing')};return {data:new Blob([corrupt?Buffer.alloc(payload.length):payload])}}}}}}
 const context={exports:{},URL,Response,ReadableStream,Uint8Array,process:{env},require(name){if(name==='node:crypto')return crypto;if(name==='@/lib/gallery/environment')return require('./helpers/load-gallery-environment.cjs')(env);if(name==='next/server')return {NextResponse:{json:(body,opts)=>Response.json(body,opts)}};if(name==='next/headers')return {cookies:()=>({get:()=>null})};if(name==='@supabase/ssr')return {createServerClient:()=>({auth:{getUser:async()=>({data:{user:user?{id:user}:null}})}})};if(name.endsWith('/admin'))return {createAdminClient:()=>admin};throw Error(name)}}
 vm.runInNewContext(source,context)
 return {get:()=>context.exports.GET({url:'https://www.cafe-sativa.com/api/gallery/download?order='+id}),counts:()=>({reads,db}),payload}
}
test('Gallery delivery: authenticated paid buyer receives exact private bytes with no cache or bearer link',async()=>{for(const opts of [{},{large:true}]){const x=setup(opts),r=await x.get();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.equal(r.headers.get('content-disposition'),'attachment; filename="cafe-sativa-artwork.bin"');assert.deepEqual(Buffer.from(await r.arrayBuffer()),x.payload);assert.equal(x.counts().reads,1)}})
test('Gallery delivery: same URL does not authorize a nonbuyer, anonymous user, blocked preview, missing approval, revoked edition, wrong product or refund',async()=>{for(const [opts,status] of [[{preview:true},503],[{user:null},401],[{user:'other'},404],[{state:'refunded'},404],[{state:'pending'},404],[{assetMissing:true},404],[{revoked:true},404],[{wrongProduct:true},404]]){const x=setup(opts);assert.equal((await x.get()).status,status);assert.equal(x.counts().reads,0);if(opts.preview)assert.equal(x.counts().db,0)}})
test('Gallery delivery: refund or mapping/edition change during private read never discloses bytes',async()=>{for(const opts of [{refundDuringRead:true},{mappingChanges:true},{editionChanges:true}]){const x=setup(opts),r=await x.get();assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'Download unavailable'})}})
test('Gallery delivery: private destination and actual integrity are mandatory, including after reading',async()=>{for(const opts of [{bucketPublic:true},{bucketMissing:true},{bucketWrongId:true},{bucketChanges:true},{corrupt:true},{missing:true}]){const x=setup(opts),r=await x.get();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Download unavailable'});assert.equal(x.counts().reads,opts.bucketChanges||opts.corrupt||opts.missing?1:0)}})
const stageSource=ts.transpileModule(fs.readFileSync('lib/gallery/stage-approved-artwork.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function stageFixture({publicSource=false,publicDestination=false,missing=false,changes=false,readbackCorrupt=false,readbackMissing=false,uploadConflict=false,privacyLostAfterUpload=false}={}){
 const bytes=Buffer.from('synthetic approved artwork'),sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex')
 let reads=0,writes=0,bucketChecks=0
 const rows={gallery_private_deliveries:{order_id:id,product_id:product,object_path:id+'/'+edition,approved_asset_id:edition},orders:{paid_at:'now',fulfillment_state:'pending'},gallery_approved_assets:{object_path:product+'/'+edition,sha256,product_id:product,revoked_at:null}}
 const admin={from(table){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:rows[table]})}},storage:{
  getBucket:async(name)=>{bucketChecks++;return {error:missing?Error('missing'):null,data:{id:name,public:name==='gallery-approved'?publicSource:publicDestination||(changes&&reads>0)||(privacyLostAfterUpload&&writes>0)}}},
  from(name){return {download:async()=>{reads++;if(name==='gallery-private'&&readbackMissing)return {error:Error('missing')};return {data:new Blob([name==='gallery-private'&&readbackCorrupt?Buffer.alloc(bytes.length):bytes])}},upload:async(_path,body,options)=>{writes++;assert.deepEqual(body,bytes);assert.equal(options.upsert,false);return {error:uploadConflict?Error('already exists'):null}}}}
 }}
 const ctx={exports:{},Buffer,process:{env:{GALLERY_DIGITAL_WORKER:'true'}},require(name){if(name==='node:crypto')return require(name);if(name==='@/lib/supabase/admin')return {createAdminClient:()=>admin};throw Error(name)}}
 vm.runInNewContext(stageSource,ctx)
 return {run:()=>ctx.exports.stageApprovedArtwork(id),counts:()=>({reads,writes,bucketChecks})}
}
test('Gallery staging: both buckets must remain private before copying; verified readback is required for success or idempotent retry',async()=>{
 for(const opts of [{publicSource:true},{publicDestination:true},{missing:true},{changes:true}]){
  const x=stageFixture(opts);assert.equal(await x.run(),false);assert.equal(x.counts().writes,0)
 }
 for(const opts of [{readbackCorrupt:true},{readbackMissing:true},{privacyLostAfterUpload:true}]){
  const x=stageFixture(opts);assert.equal(await x.run(),false);assert.equal(x.counts().writes,1)
 }
 for(const opts of [{},{uploadConflict:true}]){
  const x=stageFixture(opts);assert.equal(await x.run(),true);assert.equal(x.counts().reads,2);assert.equal(x.counts().writes,1)
 }
})
