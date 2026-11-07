const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const js=ts.transpileModule(fs.readFileSync('lib/content/social-delivery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const mcpJs=ts.transpileModule(fs.readFileSync('lib/content/metricool-mcp.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const destination=require('./helpers/load-ts.cjs')('lib/content/social-destination.ts')
function loadMcp(fetch) {
 const exports={}
 vm.runInNewContext(mcpJs,{exports,require:n=>n.endsWith('/social-destination')?destination:({METRICOOL_MCP:'https://example.invalid/mcp'}),fetch,Date,Error,Promise,Array,String,AbortSignal,TextDecoder,Uint8Array,JSON,Intl})
 return exports
}
const {MetricoolHttpError}=loadMcp(()=>{throw Error('Unused fetch')})
function harness({rows,error,readOnly=false,queued=null,httpStatus=null}={}) {
 const calls=[],writes=[],queueReads=[]
 const db={from(table){
   let patch=null,filters={}
   const q={
     select(){return q},order(){return q},limit(){return q},lt(){return q},in(){return q},
     eq(k,v){filters[k]=v;return q},update(value){patch=value;return q},
     maybeSingle:async()=>{queueReads.push(table);return {data:queued,error:null}},
     then(resolve,reject){if(patch)writes.push({patch,filters});return Promise.resolve({data:null,error:null}).then(resolve,reject)}
   };return q
 }}
 let session={call:async(name,args)=>{calls.push({name,args});if(error)throw error;return []}}
 let HttpError=MetricoolHttpError
 if(httpStatus!==null) {
   const mcp=loadMcp(async(_url,options)=>{
     const request=JSON.parse(options.body)
     calls.push({name:request.method,args:request.params})
     if(request.method==='tools/call')return new Response('secret provider body must not leak',{status:httpStatus})
     if(request.method==='notifications/initialized')return new Response(null,{status:202})
     return Response.json({jsonrpc:'2.0',id:request.id,result:request.method==='tools/list'?{tools:[{name:'getScheduledPosts'}]}:{}})
   })
   HttpError=mcp.MetricoolHttpError
   session={call:async(...args)=>(await (session.ready ||= mcp.metricoolSession('placeholder-test-token'))).call(...args)}
 }
 const imports={
  '@/lib/content/social-destination':destination,
  '@/lib/content/metricool-mcp':{MetricoolHttpError:HttpError},
  '@/lib/content/social-receipts':{dueSocialReceipts:async()=>({data:rows,error:null})},
  '@/lib/supabase/admin':{createAdminClient:()=>db},
  '@/lib/content/social-connection':{withSocialConnection:fn=>fn({db,session,brand:{timezone:'America/Los_Angeles'},enabled:true})},
  '@/lib/content/approved-media':{},'@/lib/content/site':{},
  '@/lib/content/social-contract':{verifiedSocialPublication:()=>null,validSocialApproval:()=>false},
  '@/lib/content/video-variants':{},'@/lib/content/video-formats':{},
 }
 const exports={}
 vm.runInNewContext(js,{exports,require:n=>{assert.ok(imports[n],n);return imports[n]},Date,Error,Promise,Array,String})
 return {run:()=>exports.processSocialDelivery({readOnly}),calls,writes,queueReads}
}
const old={id:'old',state:'scheduled',scheduled_at:'2024-01-01T12:00:00Z',provider_uuid:'old',receipt:{observation:'Saved receipt'}}
const recent={id:'recent',state:'scheduled',scheduled_at:'2026-11-05T12:00:00Z',provider_uuid:'recent',receipt:{}}
test('widely separated dates never produce an unbounded provider window',async()=>{
 const h=harness({rows:[old,recent]});const result=await h.run()
 assert.equal(h.calls.length,1)
 const args=h.calls[0].args
 assert.equal(Date.parse(args.toDate)-Date.parse(args.fromDate),3*86400000)
 assert.equal(h.writes.filter(w=>w.filters.id==='old').length,1)
 assert.equal(h.writes.filter(w=>w.filters.id==='recent').length,0)
 assert.equal(result.reconciled,1);assert.equal(h.queueReads.length,1)
})
test('next oldest cohort is processed on its own bounded window',async()=>{
 const h=harness({rows:[recent,old]});await h.run()
 assert.equal(h.writes.filter(w=>w.filters.id==='recent').length,1)
 assert.equal(h.writes.filter(w=>w.filters.id==='old').length,0)
})
test('same-day rows share a single request and missing queue entries remain unconfirmed',async()=>{
 const h=harness({rows:[old,{...old,id:'second',scheduled_at:'2024-01-01T23:00:00Z'}]})
 const result=await h.run();assert.equal(h.calls.length,1);assert.equal(result.reconciled,2)
 for(const write of h.writes.filter(w=>w.filters.id)){
   assert.equal(write.filters.state,'scheduled')
   assert.equal(write.patch.state,undefined)
   assert.equal(write.patch.receipt.publicationConfirmed,undefined)
   assert.match(write.patch.receipt.observation,/remains unconfirmed/)
 }
})
test('historical provider error is throttled without rewriting receipts or starving queue inspection',async()=>{
 const h=harness({rows:[old,recent],error:new MetricoolHttpError(422)})
 const result=await h.run()
 assert.equal(result.receiptErrors,1);assert.equal(result.reconciled,0)
 const write=h.writes.find(w=>w.filters.id==='old')
 assert.ok(write.patch.checked_at);assert.match(write.patch.error,/No resubmission/)
 assert.equal(write.patch.receipt,undefined);assert.equal(write.patch.state,undefined)
 assert.equal(h.queueReads.length,1);assert.equal(h.calls.some(c=>c.name==='createScheduledPost'),false)
})
test('queued items retain approval gate after unrelated receipt failure',async()=>{
 const h=harness({rows:[old],error:new MetricoolHttpError(422),queued:{id:'queued',content_item_id:'item'}})
 const result=await h.run()
 assert.equal(result.status,'blocked')
 assert.equal(h.calls.some(c=>c.name==='createScheduledPost'),false)
 assert.match(result.error,/approval/)
})
test('OAuth provider errors stay fail-closed before queued work',async()=>{
 const h=harness({rows:[old],error:new Error('Metricool OAuth invalid_grant (HTTP 400)')})
 await assert.rejects(h.run(),/OAuth/)
 assert.equal(h.queueReads.length,0)
 assert.equal(h.writes.filter(w=>w.filters.id).length,0)
})
test('read-only provider error never updates receipt ledger or touches queue',async()=>{
 const h=harness({rows:[old],error:new Error('Provider unavailable'),readOnly:true})
 await assert.rejects(h.run(),/Provider unavailable/)
 assert.equal(h.writes.length,0);assert.equal(h.queueReads.length,0)
})
test('read-only success never updates receipt ledger or touches queue',async()=>{
 const h=harness({rows:[old,recent],readOnly:true});await h.run()
 assert.equal(h.writes.length,0);assert.equal(h.queueReads.length,0);assert.equal(h.calls.length,1)
})

for(const httpStatus of [401,403])test('real MCP HTTP '+httpStatus+' stops worker before queue access',async()=>{
 const h=harness({rows:[old],httpStatus})
 await assert.rejects(h.run(),error=>{
   assert.equal(error.status,httpStatus)
   assert.equal(error.message,'Metricool MCP HTTP request failed')
   assert.doesNotMatch(error.message,/placeholder-test-token|secret provider body/)
   return true
 })
 assert.equal(h.queueReads.length,0)
 assert.equal(h.writes.filter(w=>w.filters.id).length,0)
 assert.equal(h.calls.filter(c=>c.name==='tools/call').length,1)
})
test('unclassified MCP failures remain fail-closed',async()=>{
 const h=harness({rows:[old],error:new Error('Metricool operation failed')})
 await assert.rejects(h.run(),/operation failed/)
 assert.equal(h.queueReads.length,0);assert.equal(h.writes.filter(w=>w.filters.id).length,0)
})
test('real MCP range rejection is isolated without replay',async()=>{
 const h=harness({rows:[old],httpStatus:422})
 const result=await h.run()
 assert.equal(result.receiptErrors,1)
 assert.equal(h.queueReads.length,1)
 assert.equal(h.calls.filter(c=>c.name==='tools/call').length,1)
})
