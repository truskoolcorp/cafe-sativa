const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync('app/api/webhooks/stripe/route.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  esModuleInterop: true
}}).outputText

function setup(event, options = {}) {
  const actions = []
  const sub = options.subscription || {
    id: 'sub_1', status: 'active', metadata: { user_id: 'user_1', site: 'cafe-sativa', tier: 'regular' },
    customer: 'cus_1', items: { data: [{ price: { id: 'price_approved' }, current_period_end: 1800000000 }] }
  }
  const stripe = {
    webhooks: { constructEvent: () => { if(options.invalidSignature) throw Error('invalid signature'); return event } },
    subscriptions: { retrieve: async () => sub },
    checkout: { sessions: { listLineItems: async () => ({ data: [], has_more: false }) } },
    paymentIntents: { retrieve: async () => ({ application_fee_amount: 0 }) }
  }
  const db = {
    rpc: async (name, input) => {
      actions.push({ op: 'rpc', name, input })
      return { data: options.rpcResult || { id: 'order_1', created: true, state: 'paid' }, error: null }
    },
    from: table => ({
      upsert: async (data) => { actions.push({op: 'upsert', table, data}); return {error:null} },
      update: data => {
        actions.push({op:'update',table,data})
        return { eq: () => ({ error:null }) }
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({data: table==='tickets' ? options.ticket || null : null,error:null}) })
      })
    })
  }
  class StripeMock { constructor() { return stripe } }
  const exports = {}
  const requireMock = name => {
    if (name === 'next/server') return { NextResponse: { json: (body, init={}) => ({status:init.status || 200,body}) } }
    if (name === 'stripe') return { __esModule:true,default:StripeMock }
    if (name === '@/lib/supabase/admin') return {createAdminClient:()=>db}
    if (name === '@/lib/membership-prices') return {cafeSubscriptionTier: s => {
      if(s.metadata?.site && s.metadata.site!=='cafe-sativa')return null
      return s.items?.data?.[0]?.price?.id === 'price_approved' ? 'regular' : null
    }}
    throw new Error('Unexpected import '+name)
  }
  vm.runInNewContext(compiled,{exports,require:requireMock,process:{env:{
    STRIPE_SECRET_KEY:'sk_test_placeholder',STRIPE_WEBHOOK_SECRET:'whsec_placeholder'
  }}, console:{log(){},warn(){},error(){}},Date,Number,Error,Promise})
  return {actions,post: () => exports.POST({
    headers:{get:()=> 'signature'},
    text:async()=> '{}'
  })}
}

test('unpaid checkout never grants access', async () => {
  const h=setup({type:'checkout.session.completed',data:{object:{
    payment_status:'unpaid',metadata:{kind:'ticket',site:'cafe-sativa'}
  }}})
  assert.equal((await h.post()).status,200)
  assert.equal(h.actions.length,0)
})

test('ticket checkout from another project never records a payment',async()=>{
  const h=setup({type:'checkout.session.completed',data:{object:{
    payment_status:'paid',mode:'payment',currency:'usd',amount_total:1200,
    metadata:{kind:'ticket',site:'another-project',user_id:'user_1',event_id:'event_1'}
  }}})
  assert.equal((await h.post()).status,200)
  assert.equal(h.actions.length,0)
})

test('duplicate ticket receipt is not reissued outside the atomic DB procedure',async()=>{
  const h=setup({type:'checkout.session.completed',data:{object:{
    payment_status:'paid',mode:'payment',currency:'usd',amount_total:1200,
    payment_intent:'pi_1',id:'cs_1',
    metadata:{kind:'ticket',site:'cafe-sativa',user_id:'user_1',event_id:'event_1',reservation_id:'res_1'}
  }}},{rpcResult:{created:false,state:'paid'}})
  assert.equal((await h.post()).status,200)
  assert.equal(h.actions.filter(a=>a.op==='rpc'&&a.name==='cs_record_ticket_payment').length,1)
  assert.equal(h.actions.filter(a=>a.op!=='rpc').length,0)
})

test('subscription cancellation marks a verified membership canceled',async()=>{
  const h=setup({type:'customer.subscription.deleted',data:{object:{
    id:'sub_1',status:'canceled',metadata:{user_id:'user_1',site:'cafe-sativa'},
    customer:'cus_1',items:{data:[{price:{id:'price_approved'}}]}
  }}})
  assert.equal((await h.post()).status,200)
  const write=h.actions.find(a=>a.table==='memberships')
  assert.equal(write.op,'upsert')
  assert.equal(write.data.status,'canceled')
})

test('foreign subscription never grants membership',async()=>{
  const h=setup({type:'customer.subscription.deleted',data:{object:{
    id:'sub_foreign',status:'active',metadata:{user_id:'user_1',site:'other-site'},
    customer:'cus_1',items:{data:[{price:{id:'price_approved'}}]}
  }}})
  assert.equal((await h.post()).status,200)
  assert.equal(h.actions.length,0)
})

test('refund updates the original order and ticket records, never creates new charges',async()=>{
  const h=setup({type:'charge.refunded',data:{object:{
    payment_intent:'pi_1',refunded:true
  }}},{ticket:{id:'ticket_1',state:'paid'}})
  assert.equal((await h.post()).status,200)
  assert.equal(h.actions.filter(a=>a.op==='update').length,2)
  assert.equal(h.actions[0].data.fulfillment_state,'refunded')
  assert.equal(h.actions[1].data.state,'refunded')
})


test('invalid Stripe signature cannot write fulfillment state',async()=>{
  const h=setup({type:'checkout.session.completed',data:{object:{payment_status:'paid',metadata:{site:'cafe-sativa',kind:'ticket'}}}},{invalidSignature:true})
  assert.equal((await h.post()).status,400)
  assert.equal(h.actions.length,0)
})

test('replayed paid ticket receipt delegates exclusively to atomic procedure',async()=>{
  const h=setup({type:'checkout.session.completed',data:{object:{
    payment_status:'paid',mode:'payment',currency:'usd',amount_total:1200,
    payment_intent:'pi_1',id:'cs_1',
    metadata:{kind:'ticket',site:'cafe-sativa',user_id:'user_1',event_id:'event_1',reservation_id:'res_1'}
  }}},{rpcResult:{created:false,state:'paid'}})
  assert.equal((await h.post()).status,200)
  assert.equal((await h.post()).status,200)
  const writes=h.actions.filter(a=>a.op==='rpc'&&a.name==='cs_record_ticket_payment')
  assert.equal(writes.length,2)
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].input)),JSON.parse(JSON.stringify(writes[1].input)))
  assert.equal(h.actions.filter(a=>a.op!=='rpc').length,0)
})
