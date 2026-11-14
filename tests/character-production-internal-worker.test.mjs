import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createInternalCharacterWorker} from '../lib/content/character-production-internal-worker.ts'
const request=(method='GET')=>new Request('https://www.cafe-sativa.com/api/content/worker',{method,headers:{authorization:'Bearer existing-cron'}})
for(const [name,authorized,enabled,configuration,status] of [['unauthorized',false,true,null,401],['disabled',true,false,null,503],['unconfigured',true,true,null,503]])test(name+' never constructs backend or calls provider',async()=>{let opened=0;const handler=createInternalCharacterWorker({authorize:()=>authorized,enabled:()=>enabled,configuration,open:()=>{opened++;throw Error('not allowed')}});assert.equal((await handler(request())).status,status);assert.equal(opened,0)})
test('method cannot turn cron handler into arbitrary caller submission',async()=>{let opened=0;const handler=createInternalCharacterWorker({authorize:()=>true,enabled:()=>true,configuration:null,open:()=>{opened++;throw Error('not allowed')}});assert.equal((await handler(request('POST'))).status,405);assert.equal(opened,0)})
test('dormant production entry uses existing auth and cannot open a privileged backend',()=>{const source=readFileSync(new URL('../lib/content/character-production-internal-entry.ts',import.meta.url),'utf8');assert.match(source,/authorize:cronAuthorized/);assert.match(source,/reviewedManifest\(\):InternalProductionManifest\|null\{return null\}/);assert.doesNotMatch(source,/createAdminClient|SERVICE_ROLE|HEYGEN_API_KEY/);const route=readFileSync(new URL('../app/api/content/worker/route.ts',import.meta.url),'utf8');assert.match(route,/processInternalCharacters\(req\):processContent\(req\)/)})
const now=Date.now(),configuration={engine:{enabled:true,provider:'heygen',model:'avatar_v',characters:['synthetic'],maxVideoBytes:1024,now:()=>now},heygen:{enabled:true,linkId:'account',model:'avatar_v',bindings:[{characterId:'synthetic',avatarId:'avatar',voiceId:'voice',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64)}],mediaOrigins:['https://files2.heygen.ai'],maxVideoBytes:1024,timeoutMs:1000}}
function dependencies(calls,fail=false){return {rpc:{rpc:async(name,args)=>{calls.push(name);if(name==='character_production_pending')return {data:[],error:fail?'unavailable':null};if(name==='character_production_due'){assert.equal(args.p_limit,1);return {data:{rows:[],observedAt:now},error:null}}throw Error('unexpected write')}},storage:{getBucket:async()=>{throw Error('unneeded storage read')},from:()=>{throw Error('unneeded storage access')}},transport:{create_video_from_avatar:async()=>{throw Error('unexpected paid call')},get_video:async()=>{throw Error('no pending tasks')}},inventoryTransport:{list_avatar_looks:async()=>{throw Error('no due slots')},list_voices:async()=>{throw Error('no due slots')}},codecs:{receipt:r=>r,status:r=>r},readCanon:async()=>null,normalizeCanon:()=>null}}
test('configured composition collects exact originals before bounded due query',async()=>{const calls=[];const handler=createInternalCharacterWorker({authorize:()=>true,enabled:()=>true,configuration,open:()=>dependencies(calls)});const result=await handler(request());assert.equal(result.status,200);assert.deepEqual(calls,['character_production_pending','character_production_due']);assert.equal((await result.json()).submitted,0)})
test('uncertain collection prevents queue scan or paid submission',async()=>{const calls=[];const handler=createInternalCharacterWorker({authorize:()=>true,enabled:()=>true,configuration,open:()=>dependencies(calls,true)});assert.equal((await handler(request())).status,503);assert.deepEqual(calls,['character_production_pending'])})

test('finite tick cancels backend and keeps admission closed until unresolved transport settles',async()=>{
 let release,seenSignal
 const pending=new Promise(resolve=>release=resolve)
 const handler=createInternalCharacterWorker({authorize:()=>true,enabled:()=>true,configuration,timeoutMs:10,open:signal=>{
  seenSignal=signal
  const d=dependencies([])
  d.rpc={rpc:()=>pending}
  return d
 }})
 assert.equal((await handler(request())).status,503)
 assert.equal(seenSignal.aborted,true)
 assert.equal((await handler(request())).status,429)
 release({data:[],error:'cancelled'})
 await new Promise(resolve=>setTimeout(resolve,0))
 assert.notEqual((await handler(request())).status,429)
})
test('already cancelled request never opens backend',async()=>{
 const c=new AbortController();c.abort()
 let opened=0
 const handler=createInternalCharacterWorker({authorize:()=>true,enabled:()=>true,configuration,open:()=>{opened++;throw Error('unexpected')}})
 assert.equal((await handler(new Request(request(),{signal:c.signal}))).status,503)
 assert.equal(opened,0)
})
