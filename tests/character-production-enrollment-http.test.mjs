import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createEnrollmentHttpHandler} from '../lib/content/character-production-enrollment-http.ts'
const request=(path='',method='GET',auth='Bearer synthetic')=>new Request('https://example.test/internal'+path,{method,headers:{authorization:auth}})
const authorize=h=>h==='Bearer synthetic'
for(const phase of ['plan','work','qa'])test(phase+' absent manifest stays inert even with authorized caller',async()=>{
 const run=createEnrollmentHttpHandler(phase,authorize,null)
 assert.equal((await run(request())).status,503)
 assert.equal((await run(request('','GET','invalid'))).status,401)
})
test('bad method/query/aborted caller never opens selected runtime',async()=>{
 let calls=0;const runtime={planner:{run:async()=>{calls++;return{status:'planned'}}},worker:async()=>{calls++;return new Response()},qa:async()=>{calls++;return new Response()}}
 for(const phase of ['plan','work','qa']){
 const run=createEnrollmentHttpHandler(phase,authorize,runtime)
 assert.equal((await run(request('','POST'))).status,405)
 assert.equal((await run(request('?enrollment=foreign'))).status,400)
 const c=new AbortController();c.abort()
 assert.equal((await run(new Request('https://example.test/internal',{headers:{authorization:'Bearer synthetic'},signal:c.signal}))).status,503)
 }assert.equal(calls,0)
})
test('one code-owned phase only; no chaining or caller phase selection',async()=>{
 const calls=[];const runtime={planner:{run:async()=>{calls.push('plan');return{status:'planned',secret:'never return'}}},worker:async()=>{calls.push('work');return Response.json({status:'idle'})},qa:async()=>{calls.push('qa');return Response.json({status:'idle'})}}
 for(const phase of ['plan','work','qa']){
 const r=await createEnrollmentHttpHandler(phase,authorize,runtime)(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:phase==='plan'?'planned':'idle'})
 }assert.deepEqual(calls,['plan','work','qa'])
})
test('exceptions and invalid planner result do not leak diagnostics',async()=>{
 for(const run of [async()=>{throw Error('secret')},async()=>({status:'invented'})]){
 const r=await createEnrollmentHttpHandler('plan',authorize,{planner:{run},worker:async()=>new Response(),qa:async()=>new Response()})(request())
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{status:'held'})
 }
})
test('production binding deliberately absent and routes have no scheduling/provider import',()=>{
 const s=readFileSync('lib/content/character-production-enrollment-routes.ts','utf8');assert.match(s,/reviewedRuntime:EnrollmentHttpRuntime\|null=null/)
 for(const phase of ['plan','work','qa']){const r=readFileSync('app/api/internal/character-production/enrolled/'+phase+'/route.ts','utf8');assert.match(r,/maxDuration=60/);assert.doesNotMatch(r,/createAdminClient|fetch\(|canary|POST|process\.env/)}
})
