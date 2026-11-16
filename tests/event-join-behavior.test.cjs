const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('app/api/events/[slug]/join/route.ts','utf8')
const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText

function load({user={id:'test-user'},event={},ticket=false,membership=null,errors={}}={}) {
 const rows = {
   events: { data: Object.assign({id:'event1',status:'scheduled',ticket_price_cents:2000,free_for_tiers:['vip'],zoom_join_url:'SECRET_LINK',zoom_meeting_id:'SECRET_ID'},event),error:errors.events||null },
   tickets: { data: ticket ? [{id:'ticket1'}] : [],error:errors.tickets||null },
   memberships: { data: membership,error:errors.memberships||null },
 }
 const chain = (name) => {
   const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve(rows[name]),limit:()=>Promise.resolve(rows[name])}
   return q
 }
 const exports={}
 const context={exports,require:(n)=>{
   if(n==='next/server')return {NextResponse:{json:(body,options)=>({body,status:options.status,headers:options.headers})}}
   if(n==='@/lib/supabase/server')return {createClient:()=>({auth:{getUser:async()=>({data:{user},error:null})}})}
   if(n==='@/lib/supabase/admin')return {createAdminClient:()=>({from:chain})}
   throw Error('Unexpected dependency '+n)
 },Date,Promise}
 vm.runInNewContext(js,context)
 return exports.GET({}, {params:{slug:'test-event'}})
}
const scenarios=[
 ['anonymous', {user:null},401,false],
 ['explorer', {},403,false],
 ['expired VIP', {membership:{tier:'vip',status:'active',current_period_end:'2020-01-01T00:00:00Z'}},403,false],
 ['past-due VIP', {membership:{tier:'vip',status:'past_due',current_period_end:null}},403,false],
 ['active VIP', {membership:{tier:'vip',status:'active',current_period_end:'2099-01-01T00:00:00Z'}},200,true],
 ['valid ticket', {ticket:true},200,true],
 ['signed-in free event', {event:{ticket_price_cents:0}},200,true],
 ['event read failure', {errors:{events:{message:'failed'}}},503,false],
 ['ticket lookup failure', {errors:{tickets:{message:'failed'}}},503,false],
 ['ended event', {event:{status:'ended'}},404,false],
]
for(const [name,fixture,status,allowed] of scenarios)test(name,async()=>{
 const res=await load(fixture)
 assert.equal(res.status,status)
 assert.equal(res.headers['Cache-Control'],'private, no-store')
 if(allowed){assert.equal(res.body.zoom_join_url,'SECRET_LINK')}else{
  assert.equal(JSON.stringify(res.body).includes('SECRET_LINK'),false)
  assert.equal(JSON.stringify(res.body).includes('SECRET_ID'),false)
 }
})
