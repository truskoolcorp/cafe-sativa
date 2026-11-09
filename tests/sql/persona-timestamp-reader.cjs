// Offline SQL-export -> real TypeScript reader/model -> exact next RPC payload.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const cache=new Map()
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const c={exports:{},Buffer,Uint8Array,Intl,Date,require:n=>{if(n==='node:crypto')return crypto;assert.ok(n.startsWith('.'),`Unexpected dependency ${n}`);return load(path.resolve(path.dirname(file),n+'.ts'))}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText,c,{filename:file});cache.set(file,c.exports);return c.exports}
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),bytes=Buffer.from('0000ftypisom0000000000000000000')
const source=load('lib/content/character-promo-sources.ts'),review=load('lib/content/character-promo-review.ts'),core=load('lib/content/character-promo-delivery.ts')
const db={from(table){const q={select(){return q},eq(){return q},maybeSingle(){return q},limit(){return q},then(resolve,reject){return Promise.resolve({data:structuredClone({cs_character_promo_drafts:input.draft,cs_character_promo_delivery_plans:input.plan,cs_character_promo_qa_checks:input.qa}[table]),error:null}).then(resolve,reject)}};return q},storage:{from(){return {download:async()=>({error:null,data:{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}})}}}}
;(async()=>{
 const s=await source.readCharacterPromoSources(input.plan.id,{db,now:Date.now,readGlyph:async()=>({live:true,characters:[{id:'keith',canonical_context:input.canonOverride||'Synthetic SQL timestamp regression',primary_asset_id:'00000000-0000-0000-0000-000000000099',sha256:'b'.repeat(64),voice_id:'canonical-voice',rights_status:'approved',voice_status:'canonical',production_ready:true}]}),readMetricoolBrands:async()=>[{id:5373515,userId:4174093,timezone:input.timezoneOverride||'UTC',networksData:{facebookData:'146219355471397',threadsData:'truskoolcorp'}}]})
 const model=review.buildCharacterPromoReview(s,input.state,Date.now())
 assert.ok(model.content,JSON.stringify(model.blockers))
 if(input.expectedNextAction)assert.equal(model.nextAction,input.expectedNextAction)
 const result={content:model.content,digest:model.contentDigest,expected:model.expected,nextAction:model.nextAction}
 if(input.requireMicroseconds){
  assert.match(input.draft.voice_approved_at,/\.\d{3}(\d{1,3})(?:Z|\+00:00)$/)
  assert.notEqual(input.draft.voice_approved_at.match(/\.(\d+)(?:Z|\+00:00)$/)[1].slice(3).replace(/0/g,''),'','real clock_timestamp has nonzero submillisecond precision')
  for(const key of ['updated_at','voice_approved_at','video_qa_approved_at','publication_approved_at'])if(input.draft[key])assert.equal(s.draft[key].replace(/Z$/,'+00:00'),input.draft[key],`reader must retain exact SQL ${key}`)
 }
 if(input.final){result.snapshot=core.prepareCharacterPromo(s,Date.now());result.snapshotDigest=core.promoSnapshotDigest(result.snapshot);assert.equal(result.snapshot.draftRevision,s.draft.updated_at);assert.equal(result.snapshot.approvals.voice,s.draft.voice_approved_at);assert.equal(result.snapshot.approvals.video,s.draft.video_qa_approved_at);assert.equal(result.snapshot.approvals.publication,s.draft.publication_approved_at)}
 fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n')
})().catch(e=>{console.error(e);process.exitCode=1})
