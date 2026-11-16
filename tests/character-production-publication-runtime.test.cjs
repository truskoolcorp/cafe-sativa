const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const id='00000000-0000-4000-8000-000000000001'
function harness(selection){
 const calls=[],env={CS_CAFE_PUBLICATION_RUNTIME_ENABLED:'true'}
 let selectedConfig
 const operation=(name)=>({run:async()=>{calls.push(name);return {status:name==='authority'?'authority_recorded':name==='dispatch'?'scheduled':'publication_recorded'}},whenSettled:async()=>calls.push(name+'-drained')})
 const mods={'server-only':{},
 './character-production-recurring-entry':{createCafeRecurringEntry:d=>{selectedConfig=d;return d}},
 './character-promo-cafe-initial-standing-server':{createCafeInitialStandingOperation:(draft)=>{assert.equal(draft,id);return operation('authority')}},
 './character-promo-cafe-dispatch-server':{createCafeDispatchOperation:plan=>{assert.equal(plan,id);return operation('dispatch')}},
 './character-production-publication-reconcile-server':{createCafePublicationReconciliationOperation:plan=>{assert.equal(plan,id);return operation('reconcile')}},
 }
 const e={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/content/character-production-publication-runtime.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:e,require:n=>{assert.ok(n in mods,n);return mods[n]},process:{env},AbortSignal,Date,structuredClone})
 const config={capability:{rpc:(name,args)=>{assert.equal(name,'cs_cafe_publication_next');assert.equal(Object.keys(args).length,0);return {abortSignal(){return this},retry:async retry=>{assert.equal(retry,false);return {data:selection,error:null}}}}},semanticLease:null,verifiedCollaborators:[],authorize:()=>true,whenCapabilitySettled:async()=>calls.push('capability-drained')}
 e.createCafePublicationRuntime(config)
 return {session:selectedConfig.open(new AbortController().signal),calls,env}
}
for(const phase of ['authority','dispatch','reconcile'])test('stored '+phase+' invokes exact finite operation and drains',async()=>{
 const h=harness({phase,[phase==='authority'?'draftId':'planId']:id});assert.equal(await h.session.next(),phase)
 await h.session.stages[phase]();await h.session.whenSettled()
 assert.deepEqual(h.calls,[phase,phase+'-drained','capability-drained']);await assert.rejects(h.session.next())
})
test('foreign caller fields cannot broaden selected plan',async()=>{
 const h=harness({phase:'dispatch',planId:id,ownerId:id});await assert.rejects(h.session.next());assert.equal(h.calls.length,0)
})
test('original unknown hold never dispatches',async()=>{
 const h=harness({phase:'held',reason:'original_submission_unknown'});await assert.rejects(h.session.next());assert.equal(h.calls.length,0)
})
