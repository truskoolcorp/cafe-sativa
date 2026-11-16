const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function setup(flag='true',missing=false){const calls=[],env={CS_CHARACTER_TEXT_CHECKPOINT_ENABLED:flag},identity={key:'daily:2026-11-17:zaria-solenne',token:'11111111-1111-4111-8111-111111111111',sourceDigest:'a'.repeat(64)};let hold;
const deps={
 'server-only':{},
 '@/lib/supabase/admin':{createAdminClient:()=>({rpc:(name,args)=>{
  calls.push({name,args});return {abortSignal:signal=>({retry:async retry=>{
   assert.equal(retry,false);if(hold)await hold;signal.throwIfAborted();return {data:missing?null:{stored:true},error:null}
  }})}
 }})},
 './character-production-bounded-fetch':{createProductionFetch:()=>({fetch(){},async whenSettled(){calls.push('drained')}})},
 './character-production-text-checkpoint':{
  validateCheckpointIdentity:i=>{if(i.key==='daily:2026-11-16:zaria-solenne')throw Error('checkpoint_unconfirmed')},
  createTextCheckpointReparser:d=>({async reparse(signal){await d.read(signal);return {status:'unapproved_checkpoint',currentAuthorityVerified:false}}})
 }
};
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/content/character-production-text-checkpoint-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:n=>deps[n],process:{env},structuredClone,AbortSignal});return {create:m.exports.createTextCheckpointReadOperation,identity,calls,env,setHold:p=>hold=p}}
test('private read defaults off, exact identity only and no provider or mutation RPC',async()=>{const off=setup(''),disabled=off.create(off.identity);assert.equal((await disabled.run(new AbortController().signal)).status,'disabled');assert.deepEqual(off.calls,[]);const f=setup(),op=f.create(f.identity);const result=await op.run(new AbortController().signal);assert.equal(result.currentAuthorityVerified,false);assert.equal(f.calls[0].name,'character_production_text_checkpoint_read');assert.equal(f.calls[0].args.p_key,f.identity.key);assert.equal(f.calls[0].args.p_token,f.identity.token);assert.equal(f.calls[0].args.p_digest,f.identity.sourceDigest);await op.whenSettled();assert.equal((await op.run(new AbortController().signal)).status,'disabled')})
test('missing checkpoint holds, abort joins read and network drain, frozen denied',async()=>{const f=setup('true',true),op=f.create(f.identity);await assert.rejects(op.run(new AbortController().signal),/checkpoint_unconfirmed/);await assert.rejects(op.whenSettled());assert.ok(f.calls.includes('drained'));assert.throws(()=>f.create({...f.identity,key:'daily:2026-11-16:zaria-solenne'}));const g=setup();let release;g.setHold(new Promise(r=>release=r));const c=new AbortController(),p=g.create(g.identity),run=p.run(c.signal);c.abort();release();await assert.rejects(run);await assert.rejects(p.whenSettled());assert.ok(g.calls.includes('drained'))})
test('read joins pending transport and flag revocation holds before result',async()=>{const f=setup();let release;f.setHold(new Promise(r=>release=r));const op=f.create(f.identity),run=op.run(new AbortController().signal);const rejected=assert.rejects(run,/checkpoint_unconfirmed/);f.env.CS_CHARACTER_TEXT_CHECKPOINT_ENABLED='false';let done=false;const drain=op.whenSettled().catch(()=>{}).then(()=>done=true);await new Promise(r=>setImmediate(r));assert.equal(done,false);assert.ok(!f.calls.includes('drained'));release();await rejected;await drain;assert.equal(done,true);assert.ok(f.calls.includes('drained'))})
