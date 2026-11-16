const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const ts=require('typescript')
const path=require('node:path')
const file=path.join(__dirname,'../lib/content/character-promo-cafe-dispatch-server.ts')
const id='00000000-0000-4000-8000-000000000001'
function setup(options={}){
 let calls=[],resolve
 const schedule={planId:id,videoPath:'x',videoSha256:'a'.repeat(64)}
 const candidate={schedule},db={storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://store.test/storage/v1/object/sign/cafe-sativa-content/x'}})})}}
 const mods={
 'server-only':{},'node:crypto':require('node:crypto'),
 '@/lib/supabase/admin':{createAdminClient:()=>db},
 './character-production-bounded-fetch':{createProductionFetch:(_signal,native)=>({fetch:async(...args)=>{if(options.waitNative)await options.waitNative();return native(...args)},whenSettled:async()=>{calls.push('network-drained')}})},
 './character-promo-cafe-read-fetch':{cafeBoundedReadFetch:f=>f},
 './character-promo-cafe-editorial-from-plan':{cafeEditorialFromPlan:(p,d,raw,verified)=>{assert.equal(raw.planId,id);calls.push('saved-editorial');return {planId:id}}},
 './character-promo-cafe-sources-server':{createCafeSourceReader:()=>({load:async()=>candidate,whenSettled:async()=>calls.push('source-drained')})},
 './character-promo-cafe-approval':{validateCafeApprovalCandidate:()=>calls.push('validated')},
 './character-promo-cafe-metricool':{cafeScheduleDigest:()=> 'digest',dispatchCafeMetricool:async(s,d)=>{await d.authorize(s,'digest');calls.push('dispatch');if(options.openSession)await d.openSession();return {status:'scheduled',publicationConfirmed:false}}},
 './character-promo-cafe-store':{createCafeMetricoolStore:()=>({}),createCafeMetricoolAuthority:(rpc,verify)=>async(s,d)=>{await verify(s,d);await rpc('cs_preflight_cafe_metricool',{p_plan:id})}},
 './character-promo-dispatch-connection':{openCharacterPromoDispatchSession:async d=>d.openSession('fixture-token')},'./character-promo-metricool':{},'./metricool-mcp':{metricoolSession:async(_token,_signal,fetcher)=>{await fetcher('https://mcp.metricool.com');return {call:async()=>({})}}},'./metricool-oauth':{},
 }
 const env={CS_CAFE_ENROLLED_DISPATCH_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://store.test'}
 const exp={},context={exports:exp,require:n=>{assert.ok(n in mods,n);return mods[n]},process:{env},AbortSignal,Date,URL,structuredClone,fetch:async()=>{calls.push('native-fetch');return {}}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
 const cap={rpc:(name,args)=>{calls.push(name);return {abortSignal(){return this},retry:async()=>({data:name==='cs_cafe_initial_editorial'?{planId:id,plan:{id},draft:{id}}:true,error:null})}}}
 return {factory:exp.createCafeDispatchOperation,cap,calls,env}
}
test('disabled does not read or dispatch',async()=>{
 const h=setup();h.env.CS_CAFE_ENROLLED_DISPATCH_ENABLED='false';assert.equal((await h.factory(id,h.cap,[]).run(new AbortController().signal)).status,'disabled');assert.equal(h.calls.length,0)
})
test('actual composition uses saved metadata, current sources and separate authority',async()=>{
 const h=setup(),op=h.factory(id,h.cap,[]);assert.equal((await op.run(new AbortController().signal)).status,'scheduled');await op.whenSettled()
 assert.ok(h.calls.includes('saved-editorial'));assert.ok(h.calls.includes('cs_preflight_cafe_metricool'));assert.ok(h.calls.includes('dispatch'));assert.ok(h.calls.includes('source-drained'));assert.equal((await op.run(new AbortController().signal)).status,'disabled')
})
test('original blocked RPC is drained and abort never reaches dispatch',async()=>{
 const h=setup();let release;h.cap.rpc=()=>({abortSignal(){return this},retry:()=>new Promise(r=>release=r)})
 const c=new AbortController(),op=h.factory(id,h.cap,[]),run=op.run(c.signal);c.abort();let settled=false;const drain=op.whenSettled().catch(()=>{}).then(()=>settled=true)
 await new Promise(r=>setImmediate(r));assert.equal(settled,false)
 release({data:{planId:id,plan:{id},draft:{id}},error:null});await assert.rejects(run);await drain;assert.equal(h.calls.includes('dispatch'),false)
})

test('revocation during delayed SDK transport blocks native request',async()=>{
 let release;const gate=new Promise(r=>release=r)
 const h=setup({openSession:true,waitNative:()=>gate}),op=h.factory(id,h.cap,[]),run=op.run(new AbortController().signal)
 await new Promise(r=>setImmediate(r));h.env.CS_CAFE_ENROLLED_DISPATCH_ENABLED='false';release()
 await assert.rejects(run);await assert.rejects(op.whenSettled());assert.equal(h.calls.includes('native-fetch'),false)
})

test('master switch revocation blocks delayed native dispatch independently of local flag',async()=>{
 let release,master=true;const gate=new Promise(r=>release=r)
 const h=setup({openSession:true,waitNative:()=>gate}),op=h.factory(id,h.cap,[],()=>master),run=op.run(new AbortController().signal)
 await new Promise(r=>setImmediate(r));master=false;release()
 await assert.rejects(run);await assert.rejects(op.whenSettled());assert.equal(h.env.CS_CAFE_ENROLLED_DISPATCH_ENABLED,'true');assert.equal(h.calls.includes('native-fetch'),false)
})
