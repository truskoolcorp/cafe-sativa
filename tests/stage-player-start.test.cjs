const assert=require('node:assert/strict')
const {test}=require('node:test')
const {shouldStartScheduledStage,startScheduledStage}=require('../lib/events/stage-player-start.ts')

test('play is never scheduled for pre-kickoff or unscheduled players',()=>{
  assert.equal(shouldStartScheduledStage(2, 1),false)
  assert.equal(shouldStartScheduledStage(undefined, 2),false)
  assert.equal(shouldStartScheduledStage(2, Infinity),false)
  assert.equal(shouldStartScheduledStage(2, 2),true)
})

test('allowed audio starts once and a saved mute is not turned on automatically',async()=>{
  for(const mute of [false,true]){
    const started=[]
    const player={muted:mute,async play(){started.push(this.muted)}}
    assert.equal(await startScheduledStage(player,()=>true,()=>assert.fail('no fallback')),'playing')
    assert.deepEqual(started,[mute])
  }
})

test('a browser sound restriction falls back to one muted attempt',async()=>{
  let fallback=0
  const states=[]
  const player={muted:false,async play(){states.push(this.muted);if(!this.muted) throw new DOMException('Denied','NotAllowedError')}}
  assert.equal(await startScheduledStage(player,()=>true,()=>fallback++),'playing-muted')
  assert.deepEqual(states,[false,true]);assert.equal(fallback,1)
})

test('an already-muted block requires a tap and a cancelled player never retries',async()=>{
  let calls=0,current=true
  const player={muted:true,async play(){calls++;throw new DOMException('Denied','NotAllowedError')}}
  assert.equal(await startScheduledStage(player,()=>current,()=>assert.fail('no retry')),'needs-tap')
  player.muted=false
  player.play=async()=>{calls++;current=false;throw new DOMException('Denied','NotAllowedError')}
  assert.equal(await startScheduledStage(player,()=>current,()=>assert.fail('no retry')),'cancelled')
  assert.equal(calls,2)
})
