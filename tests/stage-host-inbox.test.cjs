const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { test } = require('node:test')
const vm = require('node:vm')
const { decideStageAutoReply } = require('../lib/events/stage-auto-reply.ts')

const room = '5cafe000-0000-4000-8000-000000000001'
const id = '5cafe000-0000-4000-8000-000000000009'
const rowFields = ['id', 'host', 'question', 'answer', 'answer_source', 'created_at']
const src = stripTypeScriptTypes(readFileSync(`${__dirname}/../app/api/lounge/stage-questions/route.ts`, 'utf8')
  .replace(/^import .*\n/gm, '')).replace(/export /g, '')

function fixture() {
  const rows = [], session = { id: 'guest-a', moderator: false, invited: true, ended: false }
  const env = { STAGE_HOST_INBOX_ENABLED: 'true', STAGE_AUTO_TEXT_REPLIES_ENABLED: 'true' }
  const observed = { admin: 0, canon: 0, serviceCalls: 0 }
  let canonical = true
  let serviceGrant = false
  function builders(table, user = false) {
    const filter = {}, actions = {}
    const apply = () => {
      if (user) {
        const data = table === 'lounge_rooms' && filter.id === room ? { id: room, slug: 'private-rehearsal' }
          : table === 'stage_rehearsal_invites' && session.invited ? { can_draft: session.moderator, expires_at: 'test' } : null
        return { data, error: null }
      }
      assert.equal(table, 'stage_host_questions')
      let matched = rows.filter(row => Object.entries(filter).every(([key, value]) => row[key] === value))
      if (actions.upsert) {
        if (rows.some(row => row.id === actions.upsert.id)) matched = []
        else { rows.push(actions.upsert); matched = [actions.upsert] }
      }
      if (actions.update) matched.forEach(row => Object.assign(row, actions.update))
      const data = matched.map(row => Object.fromEntries(rowFields.filter(key => key in row).map(key => [key, row[key]])))
      return { data, error: null }
    }
    const builder = {
      select(){return this}, eq(k,v){filter[k]=v;return this}, gt(){return this}, is(k,v){filter[k]=v;return this}, order(){return this},
      upsert(v){actions.upsert=v;return this}, update(v){actions.update=v;return this}, limit:async()=>apply(),
      maybeSingle:async()=>{ const r=apply(); return { data:Array.isArray(r.data)?r.data[0]??null:r.data, error:r.error } },
    }
    return builder
  }
  const context = vm.createContext({ URL, Date, AbortSignal, process: { env }, NextResponse: { json:(body,opts)=>({body,status:opts.status}) },
    PRIVATE_STAGE_REHEARSAL_ROOM: room, AHNIKA_PREMIERE_SLUG: 'ahnika-already-gone',
    privateStagePlaybackSlot:()=>({ startsAt:'2026-11-22T20:03:00Z', start:0, end:session.ended ? 0 : Number.MAX_SAFE_INTEGER }), rehearsalInviteCoversCut:()=>true,
    getHost:id=>({id}), decideStageAutoReply,
    canonicalConciergeHost:async()=>{observed.canon++;return canonical ? {id:'verified'} : null},
    createClient:()=>({auth:{getUser:async()=>({data:{user:session.id?{id:session.id}:null}})},from:table=>builders(table,true)}),
    createAdminClient:()=>{observed.admin++;return {from:table=>builders(table),rpc:async(name,args)=>{
      observed.serviceCalls++
      assert.equal(name,'stage_resolve_laviche_question')
      assert.equal(args.p_room_id,room)
      assert.equal(args.p_attendee_id,session.id)
      assert.equal(args.p_show_starts_at,'2026-11-22T20:03:00Z')
      const row=rows.find(candidate=>candidate.id===args.p_question_id)
      if (!serviceGrant || !row || row.answer) return {data:null,error:null}
      row.answer='From the floor: The show starts at 2:03 PM Central.';row.answer_source='verified_host'
      return {data:row.answer,error:null}
    }}},
  })
  vm.runInContext(src+';this.handlers={GET,POST,PATCH};',context)
  function call(method, data = {}, origin = 'https://cafe.example') {
    return context.handlers[method]({ url: `https://cafe.example/api/lounge/stage-questions?roomId=${data.roomId ?? room}`,
      headers:{get:()=>origin}, json: async()=>({roomId:room,id,host:'laviche',...data}) })
  }
  return { call, session, observed, env, disableCanonical:()=>{canonical=false}, setServiceGrant:()=>{serviceGrant=true} }
}

module.exports = { fixture }

if (require.main === module) {
test('routine question uses the verified rehearsal time and retries return one receipt', async () => {
  const f=fixture();const question='What time is kickoff?',host='ahnika'
  const result=await f.call('POST',{question,host});assert.equal(result.status,201)
  assert.equal(result.body.item.answer_source,'verified_host');assert.match(result.body.item.answer,/2:03 PM Central/)
  const retry=await f.call('POST',{question,host});assert.equal(retry.status,200);assert.equal(retry.body.item.id,id)
  const mine=await f.call('GET');assert.equal(mine.body.mine.length,1)
})

test('sensitive questions are private, not sent to a host provider, and can be answered only by a moderator', async () => {
  const f=fixture();const question='I have a billing question.'
  const pending=await f.call('POST',{question});assert.equal(pending.body.item.answer,null);assert.equal(f.observed.canon,0)
  f.session.id='guest-b'
  const other=await f.call('GET');assert.equal(other.body.mine.length,0);assert.equal(other.body.pending.length,0)
  assert.equal((await f.call('PATCH',{answer:'Not authorized'})).status,403)
  assert.equal((await f.call('POST',{question})).status,409)
  f.session.moderator=true
  const queue=await f.call('GET');assert.equal(queue.body.pending[0].question,question)
  assert.equal((await f.call('PATCH',{answer:'Please use account support.'})).status,200)
  assert.equal((await f.call('PATCH',{answer:'Duplicate reply'})).status,409)
  f.session.id='guest-a';f.session.moderator=false
  const mine=await f.call('GET');assert.equal(mine.body.mine[0].answer,'Please use account support.');assert.equal(mine.body.mine[0].answer_source,'moderator')
})

test('closed, cross-origin, and uninvited requests do not reach the private table', async () => {
  const f=fixture()
  assert.equal((await f.call('POST',{question:'When does the show start?'},'https://other.example')).status,403)
  assert.equal((await f.call('GET',{roomId:id})).status,404)
  f.session.ended=true;assert.equal((await f.call('GET')).status,404);f.session.ended=false
  f.session.invited=false;assert.equal((await f.call('GET')).status,404)
  f.env.STAGE_HOST_INBOX_ENABLED='false';assert.equal((await f.call('GET')).status,404)
  assert.equal(f.observed.admin,0)
})

test('missing approved persona context leaves a reviewable question instead of an automatic answer', async () => {
  const f=fixture();f.disableCanonical()
  const result=await f.call('POST',{question:'What time is kickoff?',host:'ahnika'})
  assert.equal(result.status,201);assert.equal(result.body.item.answer,null)
})

test('Laviche service needs its own grant, preserves receipts, and cannot be used by Ahnika', async () => {
  const fixtureWithout=fixture();fixtureWithout.env.STAGE_LAVICHE_MODERATOR_ENABLED='true'
  const question='What time is kickoff?'
  const paused=fixture();paused.setServiceGrant()
  assert.equal((await paused.call('POST',{question})).body.item.answer,null)
  assert.equal(paused.observed.serviceCalls,0)
  assert.equal((await fixtureWithout.call('POST',{question})).body.item.answer,null)
  const f=fixture();f.env.STAGE_LAVICHE_MODERATOR_ENABLED='true';f.setServiceGrant()
  const receipt=await f.call('POST',{question})
  assert.match(receipt.body.item.answer,/2:03 PM Central/)
  assert.equal((await f.call('POST',{question})).body.item.answer,receipt.body.item.answer)
  assert.equal(f.observed.serviceCalls,1)
  const ahnika=await f.call('POST',{id:'5cafe000-0000-4000-8000-000000000010',question,host:'ahnika'})
  assert.equal(ahnika.body.item.answer_source,'verified_host')
  assert.equal(f.observed.serviceCalls,1)
  const sensitive=await f.call('POST',{id:'5cafe000-0000-4000-8000-000000000011',question:'Can you check my payment?'})
  assert.equal(sensitive.body.item.answer,null)
  assert.equal(f.observed.serviceCalls,1)
})
}
