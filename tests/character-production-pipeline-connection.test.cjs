const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto')
const eid='00000000-0000-4000-8000-000000000001',token='00000000-0000-4000-8000-000000000002',foreign='00000000-0000-4000-8000-000000000003'
function setup(){
 let enabled=true,context={phase:'work',enrollmentId:eid,manifestSha256:'a'.repeat(64)},wait=null,body='{}',native=0
 const signal=new AbortController().signal
 const mods={'server-only':{},'node:crypto':crypto,
 './character-production-bounded-fetch':{createProductionFetch:(_s,f)=>({fetch:async(...args)=>{if(wait)await wait;return f(...args)},whenSettled:async()=>{}})},
 '@/lib/supabase/admin':{createAdminClient:f=>({rpc:(name,args)=>({abortSignal(){return this},retry:async()=>{await f('https://backend.test/rest/rpc');return {data:name==='character_production_pipeline_context'?context:name==='character_production_recurring_next'?{enrollmentId:eid,manifestSha256:'a'.repeat(64),selectionToken:token}:true,error:null}}}),
 storage:{getBucket:async id=>({data:{id},error:null}),from:()=>({download:()=>({asStream:async()=>({data:new ReadableStream({start(c){c.enqueue(Buffer.from(body));c.close()}}),error:null})})})}
 })}}
 const e={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/content/character-production-pipeline-connection.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:e,require:n=>{assert.ok(n in mods,n);return mods[n]},AbortSignal,Buffer,structuredClone,TransformStream,Uint8Array,fetch:async()=>{native++;return {}}})
 const conn=e.openCafePipelineConnection(signal,()=>enabled),call=(name,args={})=>conn.db.rpc(name,args).abortSignal(signal).retry(false)
 return {conn,call,signal,setContext:c=>context=c,setBody:s=>body=s,setWait:p=>wait=p,disable:()=>enabled=false,native:()=>native}
}
test('capability pins exact current enrollment and returned selection, never caller token',async()=>{
 const h=setup();assert.throws(()=>h.conn.db.rpc('character_production_recurring_next',{p_enrollment:eid}))
 await h.call('character_production_pipeline_context')
 assert.throws(()=>h.conn.db.rpc('character_production_recurring_next',{p_enrollment:foreign}))
 await h.call('character_production_recurring_next',{p_enrollment:eid})
 assert.throws(()=>h.conn.db.rpc('character_production_recurring_next',{p_enrollment:eid}))
 assert.throws(()=>h.conn.db.rpc('character_production_selected_binding',{p_enrollment:eid,p_token:foreign}))
 await h.call('character_production_selected_binding',{p_enrollment:eid,p_token:token})
 await h.call('character_production_recurring_finish',{p_enrollment:eid,p_token:token,p_outcome:'settled'})
 assert.throws(()=>h.conn.db.rpc('character_production_recurring_finish',{p_enrollment:eid,p_token:token,p_outcome:'settled'}))
})
test('changed current enrollment blocks remaining capabilities',async()=>{
 const h=setup();await h.call('character_production_pipeline_context');h.setContext({phase:'work',enrollmentId:foreign,manifestSha256:'a'.repeat(64)});await assert.rejects(h.call('character_production_pipeline_context'))
})
test('native queued request checks flag again before actual fetch',async()=>{
 const h=setup();let release;h.setWait(new Promise(r=>release=r));const work=h.call('character_production_pipeline_context');h.disable();release();await assert.rejects(work);assert.equal(h.native(),0)
})
test('speech private paths pin original identity and original provider-receipt audio',async()=>{
 const h=setup(),identity={textAttemptKey:'daily:2026-11-16:zaria-solenne',textAttemptToken:token,textSourceDigest:'a'.repeat(64),scriptSha256:'b'.repeat(64)}
 const key='fresh-zaria-'+crypto.createHash('sha256').update(JSON.stringify([identity.textAttemptKey,identity.textAttemptToken,identity.scriptSha256])).digest('hex'),root='production-speech-operations/'+key
 const params={signal:h.signal,cache:'no-store',redirect:'error'}
 assert.throws(()=>h.conn.storage.from('character-production-audio').download('audio/'+'c'.repeat(64)+'.mp3',{},params))
 h.setContext({phase:'admit',identity});await h.call('character_production_pipeline_context')
 assert.throws(()=>h.conn.storage.from('cafe-sativa-characters').download('production-speech-operations/fresh-zaria-'+'d'.repeat(64)+'/claim.json',{},params))
 h.setBody(JSON.stringify({key,audioSha256:'c'.repeat(64)}))
 const r=await h.conn.storage.from('cafe-sativa-characters').download(root+'/provider-receipt.json',{},params).asStream();await new Response(r.data).text()
 assert.doesNotThrow(()=>h.conn.storage.from('character-production-audio').download('audio/'+'c'.repeat(64)+'.mp3',{},params))
 assert.throws(()=>h.conn.storage.from('character-production-audio').download('audio/'+'d'.repeat(64)+'.mp3',{},params))
})
