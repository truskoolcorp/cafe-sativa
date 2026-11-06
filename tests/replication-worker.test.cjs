const test=require('node:test'),assert=require('node:assert/strict')
const {replicateBatch}=require('../scripts/replication/replicate-batch.cjs')
const event=(n,action='upsert')=>({stream:'cafe-sativa',sequence_no:n,event_id:'event-'+n,writer_epoch:1,action,aggregate_key:'key-'+n,payload:action==='delete'?null:{n}})
function harness(records) {
 const state={checkpoint:0,records:new Map(),fail:false}
 return {state,source:{async readEvents(stream,after,limit){return records.filter(x=>x.sequence_no>after).slice(0,limit)}},target:{
  async readCheckpoint(){return state.checkpoint},
  async applyEvent(row){
   if(state.fail){state.fail=false;throw Error('network interruption')}
   if(state.records.has(row.sequence_no))return 'duplicate'
   if(row.sequence_no!==state.checkpoint+1)throw Error('gap')
   state.records.set(row.sequence_no,row);state.checkpoint=row.sequence_no;return 'applied'
  }}}
}
test('replays delayed events on next run and applies deletes as tombstones',async()=>{
 const events=[event(1)];const x=harness(events)
 assert.equal((await replicateBatch(x.source,x.target)).to,1)
 events.push(event(2,'delete'))
 assert.equal((await replicateBatch(x.source,x.target)).applied,1)
 assert.equal(x.state.records.get(2).action,'delete')
})
test('interrupt then restart resumes at last durable checkpoint',async()=>{
 const x=harness([event(1),event(2),event(3)])
 x.state.fail=true
 await assert.rejects(replicateBatch(x.source,x.target),/network interruption/)
 assert.equal(x.state.checkpoint,0)
 assert.equal((await replicateBatch(x.source,x.target)).to,3)
 assert.equal((await replicateBatch(x.source,x.target)).applied,0)
})
test('gap and mismatched writer metadata fail closed',async()=>{
 const x=harness([event(1),event(3)])
 await assert.rejects(replicateBatch(x.source,x.target),/sequence or source event violation/)
 assert.equal(x.state.checkpoint,1)
 const y=harness([{...event(1),writer_epoch:0}])
 await assert.rejects(replicateBatch(y.source,y.target),/sequence or source event violation/)
})
test('bounded batches resume deterministically',async()=>{
 const x=harness([event(1),event(2),event(3)])
 assert.equal((await replicateBatch(x.source,x.target,{limit:2})).to,2)
 assert.equal((await replicateBatch(x.source,x.target,{limit:2})).to,3)
})
