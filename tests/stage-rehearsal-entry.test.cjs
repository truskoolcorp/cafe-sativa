const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { stripTypeScriptTypes } = require('node:module')
const vm = require('node:vm')

const path = `${__dirname}/../app/stage/rehearsal/page.tsx`
const raw = readFileSync(path, 'utf8')
const guard = raw.slice(raw.indexOf('export default async function'), raw.indexOf('  const [profile, messages]'))
  .replace('export default ', '') + "return 'room-authorized'\n}"
const source = stripTypeScriptTypes(guard)

function entry({enabled = true,user = null,invite = null,room = null} = {}) {
  const queried=[]
  const chain = name=>({select(){return this},eq(){return this},gt(){return this},
    async maybeSingle(){queried.push(name);return {data:name==='stage_rehearsal_invites'?invite:room}}})
  const context=vm.createContext({ Date, process:{env:{STAGE_PRIVATE_REHEARSAL_ENABLED:enabled?'true':'false'}},
    PRIVATE_STAGE_REHEARSAL_ROOM:'test-room',
    createClient:()=>({auth:{getUser:async()=>({data:{user}})},from:chain}),
    notFound(){throw new Error('not-found')}, redirect(url){throw new Error(url)},
  })
  vm.runInContext(source+';this.entry=Rehearsal;',context)
  return {run:()=>context.entry(),queried}
}

test('signed-out and anonymous invitees get a login return link, without a room lookup',async()=>{
  for(const user of [null,{id:'g',is_anonymous:true}]){
    const check=entry({user})
    await assert.rejects(check.run(),{message:'/auth/signin?next=%2Fstage%2Frehearsal'})
    assert.deepEqual(check.queried,[])
  }
})

test('disabled, uninvited, and missing-room requests do not reveal room contents',async()=>{
  await assert.rejects(entry({enabled:false}).run(),{message:'not-found'})
  const uninvited=entry({user:{id:'g'}})
  await assert.rejects(uninvited.run(),{message:'not-found'})
  assert.deepEqual(uninvited.queried,['stage_rehearsal_invites'])
  await assert.rejects(entry({user:{id:'g'},invite:{user_id:'g'}}).run(),{message:'not-found'})
  assert.equal(await entry({user:{id:'g'},invite:{user_id:'g'},room:{id:'test-room'}}).run(),'room-authorized')
})
