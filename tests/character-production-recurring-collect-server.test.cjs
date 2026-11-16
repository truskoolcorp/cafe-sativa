const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(file,requires={}){const c={exports:{},require:n=>{if(n==='server-only')return {};if(Object.hasOwn(requires,n))return requires[n];throw Error(n)},process:requires.process,AbortSignal,AbortController,Error,Set,Object,Buffer,Uint8Array};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);return c.exports}
// Exercise the real engine/store/broker. Only provider and storage boundaries
// are synthetic; these tests do not claim a live provider receipt.
const engine=load('lib/content/character-production-engine.ts',{'node:crypto':require('node:crypto')})
const store=load('lib/content/character-production-store.ts',{'node:crypto':require('node:crypto'),'./character-production-engine.ts':engine})
const scoped=load('lib/content/character-production-scoped.ts',{'node:crypto':require('node:crypto'),'./character-production-store.ts':store})
function fixture(opts={}){
 const calls=[],c=new AbortController(),env={CS_CHARACTER_INTERNAL_WORKER_ENABLED:'true'};let reads=0,output
 const job={key:'original',token:'original-token',digest:'a'.repeat(64),taskId:'original-provider-task',provider:'heygen',model:'avatar',providerBindingRevision:'b'.repeat(64)}
 const manifest={configuration:{engine:{enabled:true,provider:'heygen',model:'avatar',maxVideoBytes:100,characters:['zaria'],now:Date.now},heygen:{enabled:true}}}
 const backend={rpc:{async rpc(name,args){calls.push([name,args]);if(name.endsWith('_pending')){reads++;if(opts.disableDuringPending&&reads===2)env.CS_CHARACTER_INTERNAL_WORKER_ENABLED='false';return {data:opts.invalid?[{}]:opts.empty||reads===2&&opts.vanish?[]:[job],error:opts.error}}if(name.endsWith('_output_status'))return {data:'upload',error:null};return {data:true,error:null}}},storage:{},whenSettled:async()=>{calls.push('settled');if(opts.settleError)throw Error('uncertain')}}
 let rpcSeen
 const runtime={createBrokeredCharacterProductionRuntime:(cfg,open)=>engine.createCharacterProductionEngine(cfg.engine,()=>{
  const deps=open();rpcSeen=deps.rpc
  return {
   store:scoped.createBrokeredProductionStore(deps.rpc,deps.outputBroker),
   validateCurrent:async()=>{throw Error('must not validate generation')},
   provider:{name:'heygen',submit:async()=>{throw Error('must not submit')},collect:async(id,rev)=>{
    calls.push(['provider-status',id,rev])
    if(opts.disableDuringCollect)env.CS_CHARACTER_INTERNAL_WORKER_ENABLED='false'
    if(opts.held)throw Error('provider unavailable')
    return opts.completed?{state:'completed',mime:'video/mp4',bytes:Uint8Array.from(Buffer.from('0000ftyp000000000000'))}:{state:'pending'}
   }}
  }
 })}
 const m=load('lib/content/character-production-recurring-collect-server.ts',{
  process:{env},
  './character-production-server-composition':{openInternalProduction:(m,s,budget)=>{calls.push('open');assert.equal(m,manifest);assert.equal(s,c.signal);assert.equal(budget,undefined);return backend}},
  './character-production-scoped':scoped,
  './character-production-broker-boundary':{createPrivateOutputStorage:()=>({privateBucket:async()=>true,insert:async(p,bytes)=>{output=bytes;calls.push('private-insert')},read:async()=>output})},
  './character-production-runtime':runtime
 })
 return {session:m.createRecurringCollectionSession(c.signal,manifest,opts.exactSelection?{readCollect:async()=>[{...job,key:'selected-key',taskId:'selected-task'}]}:undefined),calls,c,env,manifest,getRpc:()=>rpcSeen}
}
test('default disabled, disabled manifest, foreign signal and preabort never open',async()=>{for(const mode of ['env','manifest','foreign','abort']){const f=fixture();if(mode==='env')delete f.env.CS_CHARACTER_INTERNAL_WORKER_ENABLED;if(mode==='manifest')f.manifest.configuration.engine.enabled=false;if(mode==='abort')f.c.abort();await assert.rejects(f.session.next(mode==='foreign'?new AbortController().signal:f.c.signal));assert.equal(f.calls.length,0)}})
test('original task polled once, no generation or replay, queue re-read',async()=>{const f=fixture();assert.equal(await f.session.next(f.c.signal),'collect');await f.session.stages.collect(f.c.signal);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='character_production_pending').length,2);assert.deepEqual(f.calls.find(x=>Array.isArray(x)&&x[0]==='provider-status').slice(1),['original-provider-task','b'.repeat(64)]);await assert.rejects(f.session.stages.collect(f.c.signal));await assert.rejects(f.session.next(f.c.signal));await assert.rejects(f.getRpc().rpc('character_production_claim',{}))})
test('completed original bytes go through actual private broker receipt',async()=>{const f=fixture({completed:true});await f.session.next(f.c.signal);await f.session.stages.collect(f.c.signal);assert.equal(f.calls.filter(x=>x==='private-insert').length,1);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='character_production_output').length,1)})
test('empty is idle; already completed re-read does not poll',async()=>{for(const opts of [{empty:true},{vanish:true}]){const f=fixture(opts);const p=await f.session.next(f.c.signal);if(p)await f.session.stages.collect(f.c.signal);else await assert.rejects(f.session.stages.collect(f.c.signal));assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='provider-status'),false)}})
test('malformed/unknown queue holds without provider call',async()=>{for(const opts of [{invalid:true},{error:'unknown'}]){const f=fixture(opts);await assert.rejects(f.session.next(f.c.signal));assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='provider-status'),false)}})
test('provider uncertainty and flag revocation hold, never retry',async()=>{for(const opts of [{held:true},{disableDuringCollect:true}]){const f=fixture(opts);await f.session.next(f.c.signal);await assert.rejects(f.session.stages.collect(f.c.signal));await assert.rejects(f.session.stages.collect(f.c.signal));assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='provider-status').length,1)}})
test('revocation after selection and unknown transport settlement propagate',async()=>{const f=fixture();await f.session.next(f.c.signal);f.env.CS_CHARACTER_INTERNAL_WORKER_ENABLED='false';await assert.rejects(f.session.stages.collect(f.c.signal));const g=fixture({settleError:true});await g.session.next(g.c.signal);await assert.rejects(g.session.whenSettled())})

test('revocation while pending read is in flight blocks provider polling',async()=>{const f=fixture({disableDuringPending:true});await f.session.next(f.c.signal);await assert.rejects(f.session.stages.collect(f.c.signal));assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='provider-status'),false)})

test('selected collection never falls back to legacy head',async()=>{const f=fixture({exactSelection:true});await f.session.next(f.c.signal);await f.session.stages.collect(f.c.signal);assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='character_production_pending'),false);assert.equal(f.calls.find(x=>Array.isArray(x)&&x[0]==='provider-status')[1],'selected-task')})
