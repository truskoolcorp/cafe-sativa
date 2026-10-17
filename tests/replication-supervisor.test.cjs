const test=require('node:test'),assert=require('node:assert/strict')
const {supervise}=require('../scripts/replication/supervise.cjs')
const e={stream:'isolated-cafe',sequence_no:1,event_id:'test-1',writer_epoch:1,action:'upsert',aggregate_key:'fixture',payload:{ok:true}}
test('disabled by default and refuses production stream',async()=>{
 delete process.env.CS_REPLICATION_SANDBOX_ENABLED
 await assert.rejects(supervise({},{}),/disabled/)
 process.env.CS_REPLICATION_SANDBOX_ENABLED='true'
 await assert.rejects(supervise({}, {},{stream:'cafe-sativa'}),/production streams forbidden/)
 delete process.env.CS_REPLICATION_SANDBOX_ENABLED
})
test('supervised retry after transient outage starts from durable destination checkpoint',async()=>{
 process.env.CS_REPLICATION_SANDBOX_ENABLED='true'
 let checkpoint=0,failures=1
 const controller=new AbortController(),cycles=[],backoffs=[]
 const source={readEvents:async (_s,after)=>after===0?[e]:[]}
 const dest={readCheckpoint:async()=>checkpoint,applyEvent:async()=>{if(failures-- >0)throw Error('network interruption');checkpoint=1;return 'applied'}}
 const result=await supervise(source,dest,{stream:'isolated-cafe',signal:controller.signal,idleMs:10,
 sleepFn:async ms=>{backoffs.push(ms)},onCycle:c=>{cycles.push(c);if(c.ok&&c.to===1)controller.abort()}})
 assert.equal(result.stopped,true)
 assert.equal(checkpoint,1)
 assert.equal(cycles.filter(x=>!x.ok).length,1)
 assert.equal(cycles.filter(x=>x.ok).length,1)
 assert.deepEqual(backoffs,[10])
 delete process.env.CS_REPLICATION_SANDBOX_ENABLED
})
