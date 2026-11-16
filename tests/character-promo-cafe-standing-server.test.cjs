const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function harness(){
 const calls=[],ac=new AbortController(),lease={budgetId:'budget',countingAuthorized:true,expiresAt:Date.now()+10000},metadata=new Map([['p',{title:'Original'}]])
 let resolveLoad,resolveWrite,hold=false,uncertain=false,holdWrite=false
 const c={exports:{},Date,AbortController,AbortSignal,structuredClone,Map,require:n=>{
  if(n==='server-only')return {}
  if(n.endsWith('sources-server'))return {createCafeSourceReader:cfg=>{calls.push(['source',cfg]);return {load:async id=>{calls.push(['load',id]);if(hold)await new Promise(r=>resolveLoad=r);cfg.signal.throwIfAborted();return {}},whenSettled:async()=>calls.push(['drain'])}}}
  if(n.endsWith('budget-adapter'))return {createCafeSemanticBudgetAdapter:(db,l)=>{calls.push(['budget',l]);return {db,l}}}
  if(n.endsWith('semantic-server'))return {createCafeSemanticReviewer:b=>{calls.push(['reviewer']);return Object.assign(async(i,s)=>{s.throwIfAborted();calls.push(['assess']);return {}},{whenSettled:async()=>{calls.push(['semantic-drain'])}})}}
  if(n.endsWith('enrolled-authority'))return {createEnrolledCafeAuthorityTransport:d=>({record:async(p,h,s)=>{await d.load(p,s);await d.assess({},s);await Promise.race([d.rpc('cs_record_enrolled_cafe_authority',{p_plan:p},s),new Promise((_,reject)=>s.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))]);return {status:uncertain?'unconfirmed':'recorded',published:false,scheduled:false}}})}
  throw Error(n)
 }}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/content/character-promo-cafe-standing-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c)
 const capability={rpc(n,a){
  calls.push(['rpc',n,a]);return {abortSignal(s){return {retry(v){calls.push(['retry',v]);return holdWrite?new Promise(r=>resolveWrite=r):Promise.resolve({data:{},error:null})}}}}
 }}

 const config={signal:ac.signal,semanticLease:lease,capability,metadata,verifiedCollaborators:[]}
 return {calls,ac,lease,metadata,config,make:()=>c.exports.createCafeStandingServer(config),uncertain:()=>uncertain=true,hold:()=>hold=true,release:()=>resolveLoad(),holdWrite:()=>holdWrite=true,releaseWrite:()=>resolveWrite({data:{},error:null})}
}
test('disabled composition performs no source, model, capability or write I/O',async()=>{const h=harness(),s=h.make();assert.equal((await s.record({planId:'p',expectedDigest:'d'})).status,'disabled');assert.equal(h.calls.length,0)})
test('absent capability, absent lease, expired lease and preabort deny before I/O',async()=>{for(const change of [h=>h.config.capability=null,h=>h.config.semanticLease=null,h=>h.lease.expiresAt=0,h=>h.ac.abort()]){const h=harness();change(h);assert.equal((await h.make().record({planId:'p',expectedDigest:'d'},{enabled:true})).status,'held');assert.equal(h.calls.length,0)}})
test('enabled trusted composition snapshots metadata and uses exact no-retry scoped writer',async()=>{const h=harness(),s=h.make();h.metadata.get('p').title='Mutated';h.lease.budgetId='changed';const r=await s.record({planId:'p',expectedDigest:'d'},{enabled:true});assert.equal(r.status,'recorded');assert.equal(r.published,false);assert.equal(r.scheduled,false);assert.equal(h.calls.find(c=>c[0]==='budget')[1].budgetId,'budget');assert.equal(h.calls.find(c=>c[0]==='source')[1].metadata.get('p').title,'Original');assert.equal(h.calls.find(c=>c[0]==='rpc')[1],'cs_record_enrolled_cafe_authority');assert.equal(h.calls.find(c=>c[0]==='retry')[1],false);assert.equal((await s.record({planId:'other',expectedDigest:'d'},{enabled:true})).status,'held')})
test('concurrency and cancellation cannot progress late load to assessment/write',async()=>{const h=harness();h.hold();const s=h.make(),p=s.record({planId:'p',expectedDigest:'d'},{enabled:true});await Promise.resolve();assert.equal((await s.record({planId:'p',expectedDigest:'d'},{enabled:true})).status,'held');h.ac.abort();h.release();assert.equal((await p).status,'held');assert.equal(h.calls.some(c=>c[0]==='assess'||c[0]==='rpc'),false);assert.equal(h.calls.filter(c=>c[0]==='load').length,1)})

test('uncertain scoped-write result is preserved without retry',async()=>{const h=harness();h.uncertain();const s=h.make();assert.equal((await s.record({planId:'p',expectedDigest:'d'},{enabled:true})).status,'unconfirmed');assert.equal((await s.record({planId:'p',expectedDigest:'d'},{enabled:true})).status,'held');assert.equal(h.calls.filter(c=>c[0]==='rpc').length,1)})

test('aborted authority write retains admission until original persistence settles',async()=>{const h=harness();h.holdWrite();const s=h.make();let done=false;const p=s.record({planId:'p',expectedDigest:'d'},{enabled:true}).then(r=>{done=true;return r});while(!h.calls.some(c=>c[0]==='rpc'))await Promise.resolve();h.ac.abort();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(done,false);assert.equal((await s.record({planId:'p',expectedDigest:'d'},{enabled:true})).status,'held');h.releaseWrite();assert.equal((await p).status,'held');assert.equal(h.calls.filter(c=>c[0]==='rpc').length,1)})
test('caller cannot replace captured cancellation signal',async()=>{const h=harness(),s=h.make();h.config.signal=new AbortController().signal;h.ac.abort();assert.equal((await s.record({planId:'p',expectedDigest:'d'},{enabled:true})).status,'held');assert.equal(h.calls.length,0)})
