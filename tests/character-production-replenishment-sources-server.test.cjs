const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
test('server drain joins deferred independent GLYPH read and closes admission',async()=>{
 let release,started,drained=false,reads=0;const ready=new Promise(r=>started=r),hold=new Promise(r=>release=r)
 const deps={'@supabase/supabase-js':{createClient:()=>{throw Error('evergreen must not require anon')}},'@/lib/supabase/admin':{createAdminClient:()=>({})},'./glyph-live':{liveGlyphCharacters:async()=>{reads++;started();await hold;return {live:true}}},'./character-production-bounded-fetch':{createProductionFetch:()=>({fetch:()=>{},whenSettled:async()=>{}})},'./character-promo-cafe-read-fetch':{cafeBoundedReadFetch:f=>f},'./character-production-replenishment-sources':{createReplenishmentSourceLoader:(scope,d)=>()=>d.readGlyph(d.signal)}}
 const c={exports:{},require:n=>n==='server-only'?{}:deps[n],process:{env:{}},Set,Promise,Date,Error};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/content/character-production-replenishment-sources-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c)
 const source=c.exports.openReplenishmentSources({topic:'art-observation'},new AbortController().signal),work=source.load();await ready
 const drain=source.whenSettled().then(()=>drained=true);await Promise.resolve();assert.equal(drained,false);await assert.rejects(source.load());assert.equal(reads,1)
 release();await Promise.all([work,drain]);assert.equal(drained,true)
})
