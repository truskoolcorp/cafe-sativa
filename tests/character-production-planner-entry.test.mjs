import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createPlannerEntry} from '../lib/content/character-production-planner-entry.ts'
import {productionSlotDigest} from '../lib/content/character-production-engine.ts'
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',sha='a'.repeat(64)
const candidate={slot:{key:'fixture',script:'hello'},draftId:'draft',theme:'gallery',policyId:'policy',policyRevision:1,scheduledAt:'future'}
function fixture(options={}){
 const config={id,manifestSha256:sha,ordinals:[0],manifest:{enabled:true,deadlineMs:100,images:[],candidates:[candidate],heygen:{},expectedUsername:'reviewed'}}
 const calls=[],signals=[];let opened=0,created=0,ticked=0
 const deps={
  enabled:()=>options.enabled!==false,
  authorize:h=>h==='Bearer synthetic',
  open:signal=>{
   opened++;signals.push(signal)
   return {rpc(name,args){
    calls.push({name,args})
    return {abortSignal:s=>({retry:async retry=>{
     assert.equal(retry,false)
     if(options.read)return options.read(s)
     const data={enrollmentId:id,manifestSha256:sha,actorId:actor,policy:{policy:{id:'policy',revision:1}},candidates:[{ordinal:0,slot:candidate.slot,digest:productionSlotDigest(candidate.slot),draftId:'draft',theme:'gallery',scheduledAt:'future'}]}
     options.change?.(data)
     return {data,error:null}
    }})}
   }}
  },
  create:(m,resolve,open)=>{
   created++
   return {tick:async s=>{
    ticked++;assert.equal(await resolve(s),actor);assert.ok(open(s))
    return options.tick?options.tick(s):{status:'planned',key:'fixture',digest:'d',draftId:'draft',replayed:false}
   }}
  }
 }
 if(options.deadline)config.manifest.deadlineMs=options.deadline
 const entry=createPlannerEntry(config,deps)
 return {config,calls,signals,entry,count:()=>({opened,created,ticked})}
}
const run=(f,h='Bearer synthetic',s=new AbortController().signal)=>f.entry.run(h,s)
test('disabled opens zero dependencies',async()=>{const f=fixture({enabled:false});assert.deepEqual(await run(f),{status:'disabled'});assert.deepEqual(f.count(),{opened:0,created:0,ticked:0})})
for(const header of [null,'wrong'])test(`bad cron auth opens zero dependencies ${header}`,async()=>{const f=fixture();assert.deepEqual(await run(f,header),{status:'unauthorized'});assert.equal(f.count().opened,0)})
test('pre-aborted run opens zero dependencies',async()=>{const f=fixture(),c=new AbortController();c.abort();assert.deepEqual(await run(f,undefined,c.signal),{status:'blocked'});assert.equal(f.count().opened,0)})
test('valid exact context executes once and aborts resources on success',async()=>{const f=fixture();assert.equal((await run(f)).status,'planned');assert.deepEqual(f.count(),{opened:1,created:1,ticked:1});assert.equal(f.calls.length,2);assert.ok(f.signals.every(s=>s.aborted))})
test('configuration snapshot resists later mutation',async()=>{const f=fixture();f.config.id='changed';f.config.manifest.candidates=[];assert.equal((await run(f)).status,'planned');assert.equal(f.calls[0].args.p_enrollment,id)})
for(const [label,change] of [['actor',d=>d.actorId='not-a-uuid'],['manifest',d=>d.manifestSha256='b'.repeat(64)],['candidate',d=>d.candidates[0].theme='substitute'],['enrollment',d=>d.enrollmentId=actor]])test(`${label} mismatch opens no media runner`,async()=>{const f=fixture({change});assert.deepEqual(await run(f),{status:'blocked'});assert.equal(f.count().created,0)})
test('late bootstrap after deadline cannot start runner',async()=>{let release;const f=fixture({deadline:10,read:()=>new Promise(r=>release=r)});assert.deepEqual(await run(f),{status:'blocked'});release({data:{actorId:actor},error:null});await new Promise(r=>setTimeout(r,10));assert.equal(f.count().created,0)})
test('timeout after runner entry holds without retry',async()=>{const f=fixture({deadline:10,tick:()=>new Promise(()=>{})});assert.deepEqual(await run(f),{status:'held'});assert.equal(f.count().ticked,1);assert.ok(f.signals[0].aborted)})
test('runner error holds without retry',async()=>{const f=fixture({tick:async()=>{throw Error('ambiguous')}});assert.deepEqual(await run(f),{status:'held'});assert.equal(f.count().ticked,1)})
test('server wrapper uses real cron auth and no client fallback',()=>{const source=readFileSync(new URL('../lib/content/character-production-planner-entry-server.ts',import.meta.url),'utf8');assert.match(source,/authorize:cronAuthorized/);assert.match(source,/create:createInternalPlanner/);assert.match(source,/open:openScoped/);assert.match(source,/CS_CHARACTER_RECURRING_PLANNER_ENABLED==='true'/);assert.doesNotMatch(source,/import.*createAdminClient/)})
