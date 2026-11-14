import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs'
import {createProductionTimeBudget} from '../lib/content/character-production-time-budget.ts'
import {createProductionProviderFetch} from '../lib/content/character-production-bounded-fetch.ts'
import {createDirectHeyGenApi} from '../lib/content/character-production-heygen-direct.ts'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
test('slow read-only work exhausts admission before paid HTTP dispatch',async()=>{
 const c=new AbortController(),budget=createProductionTimeBudget(c.signal,100);let posts=0,reads=0
 const fetcher=async(_url,init)=>{if(init.method==='POST')posts++;else{reads++;await delay(60)}return Response.json({data:{id:'original',status:'pending'}})}
 const network=createProductionProviderFetch(c.signal,fetcher,100,()=>budget.requireRemaining(60))
 const api=createDirectHeyGenApi(()=> 'synthetic',network.fetch,40,100)
 await api.video('original',c.signal)
 await assert.rejects(network.fetch('https://api.heygen.com/v3/videos',{method:'POST',body:'{}'}))
 assert.equal(reads,1);assert.equal(posts,0);await network.whenSettled()
})
test('sufficient budget permits exactly one dispatch; later insufficient attempt has no retry',async()=>{
 const c=new AbortController(),budget=createProductionTimeBudget(c.signal,100);let posts=0
 const network=createProductionProviderFetch(c.signal,async()=>{posts++;return Response.json({data:{video_id:'original'}})},80,()=>budget.requireRemaining(60))
 assert.equal((await network.fetch('https://api.heygen.com/v3/videos',{method:'POST'})).status,200)
 await delay(50);await assert.rejects(network.fetch('https://api.heygen.com/v3/videos',{method:'POST'}));assert.equal(posts,1)
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
