import test from 'node:test';import assert from 'node:assert/strict'
import {createEnrolledProductionRpc} from '../lib/content/character-production-enrolled-queue-adapter.ts'
const id='11111111-1111-4111-8111-111111111111',scope={key:'owned',digest:'a'.repeat(64)}
test('pending uses enrolled RPC rather than globally limited queue',async()=>{const calls=[],db={rpc:async(n,a)=>{calls.push([n,a]);return {data:[{key:scope.key,digest:scope.digest}],error:null}}};const r=await createEnrolledProductionRpc(db,id,[scope]).rpc('character_production_pending',{p_provider:'heygen',p_model:'avatar_iv',p_limit:1});assert.equal(r.data[0].key,'owned');assert.equal(calls[0][0],'character_production_scheduler_pending');assert.equal(calls[0][1].p_enrollment,id)})
for(const data of [null,[{key:'foreign',digest:scope.digest}],[{key:'owned',digest:'b'.repeat(64)}]])test('invalid or revoked scoped result never idle '+JSON.stringify(data),async()=>{await assert.rejects(createEnrolledProductionRpc({rpc:async()=>({data,error:null})},id,[scope]).rpc('character_production_pending',{p_provider:'heygen',p_model:'avatar_iv',p_limit:1}))})
test('foreign writes and caller scope rejected before DB',async()=>{let calls=0;const r=createEnrolledProductionRpc({rpc:async()=>{calls++;return {data:null,error:null}}},id,[scope]);await assert.rejects(r.rpc('character_production_submitted',{p_key:'foreign',p_digest:scope.digest}));await assert.rejects(r.rpc('character_production_due',{p_provider:'heygen',p_model:'avatar_iv',p_limit:1,p_enrollment:id}));assert.equal(calls,0)})
test('known exact write retains existing fence',async()=>{let calls=0;const r=createEnrolledProductionRpc({rpc:async()=>{calls++;return {data:true,error:null}}},id,[scope]);await r.rpc('character_production_submitted',{p_key:'owned',p_digest:scope.digest});await assert.rejects(r.rpc('character_production_submitted',{p_key:'owned',p_digest:'b'.repeat(64)}));assert.equal(calls,1)})
test('empty valid scoped due is idle evidence; null is not',async()=>{const args={p_provider:'heygen',p_model:'avatar_iv',p_limit:1};const rpc=data=>createEnrolledProductionRpc({rpc:async()=>({data,error:null})},id,[scope]);assert.deepEqual((await rpc({observedAt:1,rows:[]}).rpc('character_production_due',args)).data.rows,[]);await assert.rejects(rpc(null).rpc('character_production_due',args))})
test('duplicate scoped records rejected even with sufficient limit',async()=>{const row={key:'owned',digest:scope.digest};await assert.rejects(createEnrolledProductionRpc({rpc:async()=>({data:[row,row],error:null})},id,[scope]).rpc('character_production_pending',{p_provider:'heygen',p_model:'avatar_iv',p_limit:2}))})
test('duplicate or empty code scope cannot open adapter',()=>{const db={rpc:async()=>({data:null,error:null})};assert.throws(()=>createEnrolledProductionRpc(db,id,[]));assert.throws(()=>createEnrolledProductionRpc(db,id,[scope,scope]))})
test('real SDK boundary admits scoped read with abort and retryfalse only',async()=>{
 const {createEnrolledServerProductionRpc}=await import('../lib/content/character-production-enrolled-queue-adapter.ts')
 const calls=[],signal=new AbortController().signal
 const db={rpc:(n,a)=>{calls.push([n,a]);return {abortSignal:s=>{assert.equal(s,signal);return {retry:async r=>{assert.equal(r,false);return {data:[],error:null}}}}}}}
 const rpc=createEnrolledServerProductionRpc(db,signal,id,[scope])
 await rpc.rpc('character_production_pending',{p_provider:'heygen',p_model:'avatar_iv',p_limit:1})
 assert.equal(calls[0][0],'character_production_scheduler_pending')
 await assert.rejects(rpc.rpc('unapproved_function',{p_key:'owned'}));assert.equal(calls.length,1)
})
test('aborted SDK boundary never opens transport',async()=>{
 const {createEnrolledServerProductionRpc}=await import('../lib/content/character-production-enrolled-queue-adapter.ts')
 const c=new AbortController();c.abort();let calls=0
 const rpc=createEnrolledServerProductionRpc({rpc:()=>{calls++;throw Error()}},c.signal,id,[scope])
 await assert.rejects(rpc.rpc('character_production_pending',{p_provider:'heygen',p_model:'avatar_iv',p_limit:1}));assert.equal(calls,0)
})
test('SQL proposal contains no grant or raw function replacement',async()=>{
 const {readFileSync}=await import('node:fs'),s=readFileSync(new URL('../docs/proposals/character-production-enrolled-queues.sql',import.meta.url),'utf8')
 assert.doesNotMatch(s,/\bGRANT\s+(?:EXECUTE|ALL|SELECT)/i)
 assert.doesNotMatch(s,/CREATE(?: OR REPLACE)? FUNCTION public.character_production_(?:due|pending)\(/)
 assert.match(s,/scheduler_current\(p_enrollment\)/)
})
