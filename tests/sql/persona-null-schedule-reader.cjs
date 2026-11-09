// Actual disposable PostgreSQL exports -> real candidate/control adapters. No live services.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const cache=new Map()
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const c={exports:{},Buffer,Uint8Array,Intl,Date,require:n=>{if(n==='node:crypto')return crypto;assert.ok(n.startsWith('.'),'Unexpected runtime dependency '+n);return load(path.resolve(path.dirname(file),n+'.ts'))}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText,c,{filename:file});cache.set(file,c.exports);return c.exports}
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),bytes=Buffer.from('0000ftypisom0000000000000000000')
const material=load('lib/content/character-promo-material.ts'),controls=load('lib/content/character-promo-controls.ts')
function db(rows){return {from(table){let columns;const q={select(v){columns=v.split(',');return q},eq(){return q},limit(){return q},maybeSingle(){return q},then(resolve,reject){let data={cs_character_promo_drafts:rows.draft,cs_character_promo_delivery_plans:rows.plan,cs_character_promo_qa_checks:rows.qa}[table];assert.notEqual(data,undefined);if(!Array.isArray(data))data=Object.fromEntries(columns.map(k=>[k,data[k]]));return Promise.resolve({data:structuredClone(data),error:null}).then(resolve,reject)}};return q},storage:{from(bucket){assert.equal(bucket,'cafe-sativa-content');return {download:async p=>{assert.equal(p,rows.draft.video_asset_path);return {error:null,data:{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}}}}}}}}
;(async()=>{
  const initial={plan:input.plan,draft:input.draft,qa:input.qa}
 const before=await material.readCharacterPromoMaterial(input.plan.id,db(initial))
 assert.equal(before.plan.scheduledAt,null);assert.equal(before.approvalGranted,false);assert.equal(before.video.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(before.draft.script,input.draft.spoken_script);assert.ok(before.blockers.includes('future_schedule_not_authored'))
 let result=input.controls
 const adapter=controls.createCharacterPromoControls(async()=>({data:result,error:null}),input.actor)
 const state=await adapter.read(input.plan.id);assert.equal(state.cohort.find(p=>p.planId===input.plan.id).scheduledAt,null)
 for(const action of ['withdraw','restore']){
  const reviewed=input[action+'Review'],receipt=input[action+'Receipt'];result=reviewed
  const review=await adapter.review({planId:input.plan.id,action});assert.equal(review.snapshot.expectedCohort.find(r=>r.plan.id===input.plan.id).plan.scheduled_at,null)
  result=receipt;const saved=await adapter.save(reviewed);assert.equal(saved.cohort.find(p=>p.planId===input.plan.id).scheduledAt,null);assert.equal(saved.dispatched,false);assert.equal(saved.generationStarted,false)
 }
 const after=await material.readCharacterPromoMaterial(input.after.plan.id,db(input.after));assert.ok(after.plan.scheduledAt);assert.equal(after.plan.caption,input.after.plan.caption);assert.equal(after.approvalGranted,false)
 console.log('PASS actual production-shaped SQL exports through candidate/control adapters: null preserved, explicit authoring reflected, no approval inferred')
})().catch(e=>{console.error(e);process.exitCode=1})
