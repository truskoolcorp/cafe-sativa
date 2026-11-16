const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto')
const occurrence='00000000-0000-4000-8000-000000000001',enrollment='00000000-0000-4000-8000-000000000002'
function harness(context,options={}){
 const retained=[],calls=[],env={CS_CHARACTER_PIPELINE_ENTRY_ENABLED:'true'}
 const account={linkId:'reviewed-link',model:'avatar_iv',aspectRatio:'16:9'},base={images:[],expectedHeyGenUsername:'reviewed-user',configuration:{engine:{characters:['zaria-solenne']},heygen:{...account,bindings:[]}}}
 const finite=(name,result)=>({run:async()=>{calls.push(name);return result},whenSettled:async()=>calls.push(name+'-drained')})
 const mods={'server-only':{},'node:crypto':crypto,
 './character-production-preparation-server':{createCafePreparationOperation:()=>finite('prepare',{status:'text_phase_finished'})},
 './character-production-first-admission-server':{createCafeFirstAdmissionOperation:()=>finite('admit',{status:'first_enrollment_admitted'})},
 './character-production-fresh-speech-receipt-store':{createFreshSpeechReceiptReader:identity=>{assert.deepEqual(JSON.parse(JSON.stringify(identity)),{key:'original'});return {recover:async()=>{calls.push('receipt-read');if(options.receiptMissing)throw Error('Missing original');return {status:'private_audio_receipt_verified'}},whenSettled:async()=>calls.push('receipt-drained')}}},
 './character-production-selected-server':{createSelectedRecurringSession:d=>{assert.equal(d.enrollmentId,enrollment);return {next:async()=>{calls.push('select');return options.waiting?null:'generate'},stages:{generate:async()=>calls.push('generate')},whenSettled:async()=>calls.push('work-drained')}}},
 './character-production-time-budget':{createProductionTimeBudget:(_s,ms)=>{assert.equal(ms,45000);return {}}},
 './character-production-manifest-snapshot':{snapshotProductionManifest:x=>structuredClone(x)},
 }
 const e={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/content/character-production-pipeline-entry.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:e,require:n=>{assert.ok(n in mods,n);return mods[n]},process:{env},AbortController,AbortSignal,Date,URL,Response,Request,Buffer,structuredClone,setTimeout:options.fakeTimer?options.fakeTimer:setTimeout,clearTimeout:options.fakeTimer?()=>{}:clearTimeout})
 const handler=e.createCafePipelineEntry({manifest:base,retain:p=>{retained.push(p);if(options.badRetain)throw Error('Lifecycle unavailable')},authorize:h=>h==='Bearer fixture',open:()=>{calls.push('open');return {db:{rpc:()=>({abortSignal(){return this},retry:async()=>{if(options.waitRead)await options.waitRead();return {data:context,error:null}}})},storage:{},whenSettled:async()=>{calls.push('connection-drained');if(options.badDrain)throw Error('Original transport unsettled')}}}})
 const request=(signal)=>new Request('https://cafe.test/api',{headers:{authorization:'Bearer fixture'},signal})
 return {handler,request,calls,env,account,retained}
}
test('prepare invokes only existing preparation finite operation',async()=>{const h=harness({phase:'prepare',occurrenceId:occurrence});const r=await h.handler(h.request());assert.equal((await r.json()).phase,'prepare');assert.ok(h.calls.includes('prepare'));assert.equal(h.calls.includes('admit'),false)})
test('admission requires actual original receipt inspection before factory',async()=>{const h=harness({phase:'admit',occurrenceId:occurrence,identity:{key:'original'}});const r=await h.handler(h.request());assert.equal((await r.json()).status,'first_enrollment_admitted');assert.ok(h.calls.indexOf('receipt-read')<h.calls.indexOf('admit'))})
test('unknown original speech never admits or synthesizes again',async()=>{const h=harness({phase:'admit',occurrenceId:occurrence,identity:{key:'original'}},{receiptMissing:true});assert.equal((await h.handler(h.request())).status,503);assert.equal(h.calls.includes('admit'),false);assert.equal(h.calls.includes('prepare'),false)})
function workContext(){const manifest=JSON.stringify({expectedUsername:'reviewed-user',heygen:{linkId:'reviewed-link',model:'avatar_iv',aspectRatio:'16:9'},candidates:[{slot:{key:'first:'+occurrence,characterId:'zaria-solenne'}}],images:[{}]});return {phase:'work',occurrenceId:occurrence,enrollmentId:enrollment,manifest,manifestSha256:crypto.createHash('sha256').update(manifest).digest('hex')}}
test('selected current enrolled work runs exactly selected phase',async()=>{const h=harness(workContext());assert.equal((await (await h.handler(h.request())).json()).phase,'generate');assert.ok(h.calls.includes('generate'));assert.equal(h.calls.includes('prepare'),false)})
test('future due work reports waiting, not complete',async()=>{const h=harness(workContext(),{waiting:true});assert.equal((await (await h.handler(h.request())).json()).status,'waiting');assert.equal(h.calls.includes('generate'),false)})
test('caller fields and stale manifest cannot open generation',async()=>{const c=workContext();c.manifest+=' ';const h=harness(c);assert.equal((await h.handler(h.request())).status,503);assert.equal(h.calls.includes('select'),false);assert.equal((await h.handler(new Request('https://cafe.test/api?phase=work'))).status,405)})
test('aborted original RPC keeps admission busy until original drains',async()=>{let release;const gate=new Promise(r=>release=r),h=harness({phase:'prepare',occurrenceId:occurrence},{waitRead:()=>gate}),c=new AbortController();const pending=h.handler(h.request(c.signal));await new Promise(r=>setImmediate(r));c.abort();assert.equal((await pending).status,503);assert.equal((await h.handler(h.request())).status,429);release();await new Promise(r=>setImmediate(r));assert.equal(h.calls.includes('prepare'),false)})
test('disabled and unauthenticated requests do not open capability',async()=>{const h=harness(null);h.env.CS_CHARACTER_PIPELINE_ENTRY_ENABLED='false';assert.equal((await h.handler(h.request())).status,503);assert.equal(h.calls.length,0);assert.equal((await h.handler(new Request('https://cafe.test/api'))).status,401)})

test('failed transport drainage stays busy instead of permitting retry',async()=>{const h=harness(null,{badDrain:true});assert.equal((await h.handler(h.request())).status,503);await new Promise(r=>setImmediate(r));assert.equal((await h.handler(h.request())).status,429)})
test('finite 85-second timeout holds response but joins original RPC before reopening',async()=>{
 let release,timeout;const gate=new Promise(r=>release=r),h=harness({phase:'prepare',occurrenceId:occurrence},{waitRead:()=>gate,fakeTimer:(f,ms)=>{assert.equal(ms,85000);timeout=f;return 1}})
 const pending=h.handler(h.request());await new Promise(r=>setImmediate(r));timeout();assert.equal((await pending).status,503);assert.equal((await h.handler(h.request())).status,429);release();await new Promise(r=>setImmediate(r));assert.equal(h.calls.includes('prepare'),false);assert.ok(h.calls.includes('connection-drained'))
})

test('host retains original drainage synchronously beyond early abort response',async()=>{
 let release;const gate=new Promise(r=>release=r),h=harness({phase:'prepare',occurrenceId:occurrence},{waitRead:()=>gate}),c=new AbortController();
 const pending=h.handler(h.request(c.signal));assert.equal(h.retained.length,1);assert.equal(h.calls.includes('open'),false);
 let settled=false;h.retained[0].then(()=>settled=true);await new Promise(r=>setImmediate(r));c.abort();assert.equal((await pending).status,503);assert.equal(settled,false);
 release();await h.retained[0];assert.equal(settled,true);assert.ok(h.calls.includes('connection-drained'));assert.equal(h.calls.includes('prepare'),false)
})
test('hosting registration failure prevents opening any capability',async()=>{const h=harness({phase:'prepare',occurrenceId:occurrence},{badRetain:true});assert.equal((await h.handler(h.request())).status,503);assert.equal(h.calls.includes('open'),false)})
