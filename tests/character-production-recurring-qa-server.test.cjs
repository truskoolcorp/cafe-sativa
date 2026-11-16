const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,requires={}){const c={exports:{},require:n=>{if(n==='server-only')return {};if(Object.hasOwn(requires,n))return requires[n];throw Error(n)},fetch:requires.fetch??global.fetch,Request,Response,ReadableStream,setTimeout,clearTimeout,process:requires.process,AbortSignal,AbortController,Error,Set,Object};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);return c.exports}
const real=load('lib/content/character-production-recurring-qa.ts')
function fixture(opts={}){const calls=[],controller=new AbortController(),env={CS_CHARACTER_QA_BRIDGE_ENABLED:opts.enabled===false?'false':'true',CS_CHARACTER_TECHNICAL_QA_ENABLED:opts.technical?'true':'false'};let reads=0;const identity={key:'real-database-slot',digest:'a'.repeat(64)}
 const m=load('lib/content/character-production-recurring-qa-server.ts',{'./character-production-recurring-qa':real,process:{env},'./character-production-qa-worker-entry':{openPrivateQaSession:s=>{calls.push('open');assert.equal(s,controller.signal);return {async evaluateSelected(){calls.push('technical');if(opts.technicalFail)throw Error('technical failed');return {qaApproved:false}},rpc:{async rpc(name,args){calls.push([name,args]);if(name.endsWith('ready_slots')){reads++;if(opts.revoke)env.CS_CHARACTER_QA_BRIDGE_ENABLED='false';return {data:opts.rows??(opts.empty?[]:reads===2&&opts.vanish?[]:[identity]),error:opts.queueError}}if(opts.revokeDuringMaterialize)env.CS_CHARACTER_QA_BRIDGE_ENABLED='false';return {data:opts.materialize??true,error:null}}},bridge:{async ingest(key,digest){calls.push(['copy',key,digest]);return {status:opts.held?'held':'ingested'}}},whenSettled:async()=>{calls.push('settled');if(opts.settleError)throw Error('unknown')}}}}})
 return {calls,controller,env,session:m.createRecurringQaSession(controller.signal,opts.exactSelection?{readQa:async()=>({key:'selected-qa',digest:'a'.repeat(64)})}:undefined,opts.technical?{item:{key:'selected-qa',digest:'a'.repeat(64)},rpc:{}}:undefined)}}
test('default disabled and preabort open no database',async()=>{for(const change of [f=>f.env.CS_CHARACTER_QA_BRIDGE_ENABLED=undefined,f=>f.controller.abort()]){const f=fixture();change(f);await assert.rejects(f.session.next(f.controller.signal));assert.equal(f.calls.length,0)}})
test('real database identity reselected and passed through materialization/private copy only',async()=>{const f=fixture();assert.equal(await f.session.next(f.controller.signal),'qa');await f.session.stages.qa(f.controller.signal);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='character_production_qa_ready_slots').length,2);assert.deepEqual(f.calls.find(x=>Array.isArray(x)&&x[0]==='copy').slice(1),['real-database-slot','a'.repeat(64)]);await assert.rejects(f.session.stages.qa(f.controller.signal));await assert.rejects(f.session.next(f.controller.signal))})
test('empty queue is idle with no stage or copy',async()=>{const f=fixture({empty:true});assert.equal(await f.session.next(f.controller.signal),null);await assert.rejects(f.session.stages.qa(f.controller.signal));assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='copy'),false)})
test('revocation, unknown queue and foreign lifetime hold',async()=>{for(const opts of [{revoke:true},{queueError:'unknown'},{rows:{}},{rows:[{},{}]}]){const f=fixture(opts);await assert.rejects(f.session.next(f.controller.signal));assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='copy'),false)}const f=fixture();await assert.rejects(f.session.next(new AbortController().signal));assert.equal(f.calls.length,0)})
test('held or invalid identity is not successful QA and never retries',async()=>{for(const opts of [{held:true},{materialize:false},{rows:[{key:'invented'}]}]){const f=fixture(opts);await f.session.next(f.controller.signal);await assert.rejects(f.session.stages.qa(f.controller.signal));await assert.rejects(f.session.stages.qa(f.controller.signal))}})
test('another worker completion between selection and stage is safe empty re-read',async()=>{const f=fixture({vanish:true});await f.session.next(f.controller.signal);await f.session.stages.qa(f.controller.signal);assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='copy'),false)})
test('late flag revocation blocks before copy; settlement failure propagates',async()=>{const f=fixture();await f.session.next(f.controller.signal);f.env.CS_CHARACTER_QA_BRIDGE_ENABLED='false';await assert.rejects(f.session.stages.qa(f.controller.signal));const g=fixture({settleError:true});await g.session.next(g.controller.signal);await assert.rejects(g.session.whenSettled())})


test('selected QA copies exact bound item without reading legacy head',async()=>{const f=fixture({exactSelection:true});await f.session.next(f.controller.signal);await f.session.stages.qa(f.controller.signal);assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='character_production_qa_ready_slots'),false);assert.equal(f.calls.find(x=>Array.isArray(x)&&x[0]==='copy')[1],'selected-qa')})

test('QA revocation during materialization prevents private copy in either mode',async()=>{for(const exactSelection of [false,true]){const f=fixture({exactSelection,revokeDuringMaterialize:true});await f.session.next(f.controller.signal);await assert.rejects(f.session.stages.qa(f.controller.signal));assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='copy'),false)}})
test('revoked QA blocks actual backend network dispatch inside bridge',async()=>{
 let dispatch,enabled=true,sent=0
 const c=new AbortController()
 const network=load('lib/content/character-production-bounded-fetch.ts')
 const m=load('lib/content/character-production-qa-worker-entry.ts',{
  fetch:async()=>{sent++;return new Response(null,{status:204})},
  'node:path':require('node:path'),'./character-production-selected-technical-qa':{createSelectedTechnicalQa:()=>assert.fail('disabled')},
  './auth':{cronAuthorized:()=>true},
  '@/lib/supabase/admin':{createAdminClient:f=>{dispatch=f;return {storage:{}}}},
  './character-production-bounded-fetch':network,
  './character-production-qa-bridge':{createCharacterProductionQaBridge:()=>({})},
  './character-production-qa-storage':{createStreamingQaStorage:()=>({})},
  './character-production-qa-worker':{createPrivateQaWorker:()=>({})},
  './character-production-original-qa':{assertOriginalQaDestination:()=>{}}
 })
 m.openPrivateQaSession(c.signal,()=>{if(!enabled)throw Error('revoked')})
 await dispatch('https://synthetic.invalid')
 const pending=dispatch('https://synthetic.invalid');enabled=false;await assert.rejects(pending);assert.equal(sent,1)
})

test('technical evaluation occurs after materialize before copy; failure denies ingest',async()=>{for(const technicalFail of [false,true]){const f=fixture({technical:true,technicalFail,exactSelection:true});await f.session.next(f.controller.signal);if(technicalFail)await assert.rejects(f.session.stages.qa(f.controller.signal));else await f.session.stages.qa(f.controller.signal);const t=f.calls.indexOf('technical'),m=f.calls.findIndex(x=>Array.isArray(x)&&x[0]==='character_production_qa_materialize'),c=f.calls.findIndex(x=>Array.isArray(x)&&x[0]==='copy');assert.ok(m>=0&&t>m);if(technicalFail)assert.equal(c,-1);else assert.ok(c>t)}})
