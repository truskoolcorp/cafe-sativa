import test from 'node:test';import assert from 'node:assert/strict'
import {createPlannerScheduler} from '../lib/content/character-production-planner-scheduler.ts'
const signal=()=>new AbortController().signal
function setup({enabled=true,read=async()=>({trusted:true}),plan=async()=>({status:'planned'}),deadlineMs=1000}={}){const calls=[];return {calls,worker:createPlannerScheduler({enabled,deadlineMs},()=>{calls.push('open');return {readCandidate:async s=>{calls.push('read');return read(s)},planner:{plan:async(i,s)=>{calls.push('plan');return plan(i,s)}}}})}}
test('disabled does not open anything',async()=>{const x=setup({enabled:false});assert.equal((await x.worker.tick(signal())).status,'disabled');assert.deepEqual(x.calls,[])})
test('one trusted candidate one plan',async()=>{const x=setup();assert.equal((await x.worker.tick(signal())).status,'planned');assert.deepEqual(x.calls,['open','read','plan'])})
test('empty store idle',async()=>{const x=setup({read:async()=>null});assert.equal((await x.worker.tick(signal())).status,'idle');assert.deepEqual(x.calls,['open','read'])})
test('aborted before opening',async()=>{const x=setup(),c=new AbortController();c.abort();assert.equal((await x.worker.tick(c.signal)).status,'blocked');assert.deepEqual(x.calls,[])})
test('hanging read deadline never plans',async()=>{const x=setup({deadlineMs:5,read:()=>new Promise(()=>{})});assert.equal((await x.worker.tick(signal())).status,'blocked');assert.deepEqual(x.calls,['open','read'])})
test('hanging write deadline held never retried',async()=>{const x=setup({deadlineMs:5,plan:()=>new Promise(()=>{})});assert.equal((await x.worker.tick(signal())).status,'held');assert.deepEqual(x.calls,['open','read','plan'])})
test('read error blocks',async()=>{const x=setup({read:async()=>{throw Error('read')}});assert.equal((await x.worker.tick(signal())).status,'blocked')})
test('ambiguous plan error held',async()=>{const x=setup({plan:async()=>{throw Error('write')}});assert.equal((await x.worker.tick(signal())).status,'held')})
test('external abort wins ignored read abort',async()=>{const x=setup({read:()=>new Promise(()=>{})}),c=new AbortController(),p=x.worker.tick(c.signal);c.abort();assert.equal((await p).status,'blocked')})
