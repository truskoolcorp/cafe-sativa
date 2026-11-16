import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs'
import {createProductionTimeBudget} from '../lib/content/character-production-time-budget.ts'
import {createProductionProviderFetch} from '../lib/content/character-production-bounded-fetch.ts'
import {createDirectHeyGenApi} from '../lib/content/character-production-heygen-direct.ts'
test('slow read-only work exhausts admission before paid HTTP dispatch',async(t)=>{
 let clock=Date.now();t.mock.method(Date,'now',()=>clock)
 const c=new AbortController(),budget=createProductionTimeBudget(c.signal,45000);let posts=0,reads=0
 // Advance the actual budget's wall clock without racing real 40/100ms timers
 // against a heavily loaded CI runner. Native dispatch still uses real guards.
 const fetcher=async(_url,init)=>{if(init.method==='POST')posts++;else{reads++;clock+=20000}return Response.json({data:{id:'original',status:'pending'}})}
 const network=createProductionProviderFetch(c.signal,fetcher,8000,()=>budget.requireRemaining(30000))
 const api=createDirectHeyGenApi(()=> 'synthetic',network.fetch,8000,8000)
 await api.video('original',c.signal)
 await assert.rejects(network.fetch('https://api.heygen.com/v3/videos',{method:'POST',body:'{}'}))
 assert.equal(reads,1);assert.equal(posts,0);await network.whenSettled()
})
test('sufficient budget permits exactly one dispatch; later insufficient attempt has no retry',async(t)=>{
 let clock=Date.now();t.mock.method(Date,'now',()=>clock)
 const c=new AbortController(),budget=createProductionTimeBudget(c.signal,45000);let posts=0
 const network=createProductionProviderFetch(c.signal,async()=>{posts++;return Response.json({data:{video_id:'original'}})},8000,()=>budget.requireRemaining(30000))
 const response=await network.fetch('https://api.heygen.com/v3/videos',{method:'POST'});assert.equal(response.status,200);await response.json()
 clock+=20000;await assert.rejects(network.fetch('https://api.heygen.com/v3/videos',{method:'POST'}));assert.equal(posts,1);await network.whenSettled()
})
test('aborted tick, invalid bounds and wall clock rollback deny admission',()=>{
 const c=new AbortController(),budget=createProductionTimeBudget(c.signal,1000)
 for(const ms of [0,-1,NaN,Infinity,45001])assert.throws(()=>budget.requireRemaining(ms))
 const old=Date.now;try{Date.now=()=>0;assert.throws(()=>budget.requireRemaining(1))}finally{Date.now=old}
 c.abort();assert.throws(()=>budget.requireRemaining(1))
})
test('actual production composition passes tick budget and reserves submit plus evidence write',()=>{
 const get=p=>fs.readFileSync(new URL('../lib/content/'+p,import.meta.url),'utf8')
 assert.match(get('character-production-internal-worker.ts'),/d.open\(controller.signal,createProductionTimeBudget\(controller.signal,timeoutMs\)\)/)
 assert.match(get('character-production-internal-entry.ts'),/openInternalProduction\(manifest,signal,budget\)/)
 assert.match(get('character-production-server-composition.ts'),/budget.requireRemaining\(\(phases\?\.submitMs\?\?8000\)\+8000\+8000\+1000\)/)
 assert.match(get('character-production-server-composition.ts'),/if\(!budget\)throw/)
})
