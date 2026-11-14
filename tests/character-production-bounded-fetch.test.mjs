import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProductionFetch} from '../lib/content/character-production-bounded-fetch.ts'
test('pre-aborted tick never dispatches',async()=>{const c=new AbortController();c.abort();let calls=0;const x=createProductionFetch(c.signal,async()=>{calls++},5);await assert.rejects(x.fetch('https://example.test'));assert.equal(calls,0)})
test('timeout aborts, never retries, and waits for unresolved request',async()=>{
 const c=new AbortController();let finish,signal,calls=0
 const x=createProductionFetch(c.signal,async(_url,init)=>{calls++;signal=init.signal;return new Promise(r=>finish=r)},5)
 await assert.rejects(x.fetch('https://example.test'))
 assert.equal(signal.aborted,true);assert.equal(calls,1)
 let settled=false;const drain=x.whenSettled().then(()=>settled=true)
 await new Promise(r=>setTimeout(r,1));assert.equal(settled,false)
 finish(new Response('ok'));await drain;assert.equal(settled,true)
})
test('caller and tick cancellation reach underlying request',async()=>{
 for(const kind of ['tick','caller']){
  const tick=new AbortController(),caller=new AbortController();let signal
  const x=createProductionFetch(tick.signal,async(_u,i)=>{signal=i.signal;return new Promise((_r,reject)=>i.signal.addEventListener('abort',()=>reject(Error('cancelled'))))},100)
  const pending=x.fetch('https://example.test',{signal:caller.signal})
  await Promise.resolve();(kind==='tick'?tick:caller).abort();await assert.rejects(pending);assert.equal(signal.aborted,true);await x.whenSettled()
 }
})
test('deadline remains active after headers and cancels a stalled body',async()=>{
 const tick=new AbortController();let cancelled=false
 const x=createProductionFetch(tick.signal,async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel(){cancelled=true}})),10)
 const response=await x.fetch('https://example.test')
 await assert.rejects(response.text(),/expired/)
 assert.equal(cancelled,true)
 tick.abort()
})
test('drain tracks original body operations that ignore cancellation',async()=>{
 const tick=new AbortController();let releaseRead,releaseCancel
 const body={getReader:()=>({read:()=>new Promise(r=>releaseRead=r),cancel:()=>new Promise(r=>releaseCancel=r)})}
 const x=createProductionFetch(tick.signal,async()=>({body,status:200,statusText:'OK',headers:new Headers()}),10)
 const response=await x.fetch('https://example.test')
 const consumed=response.text();await new Promise(r=>setTimeout(r,15))
 let drained=false;const drain=x.whenSettled().then(()=>drained=true)
 await Promise.resolve();assert.equal(drained,false)
 releaseRead({done:true});await assert.rejects(consumed)
 await Promise.resolve();assert.equal(drained,false)
 releaseCancel();await drain;assert.equal(drained,true)
})
