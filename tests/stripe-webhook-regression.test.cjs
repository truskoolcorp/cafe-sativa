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
  const env = { VERCEL_ENV:'production', STRIPE_SECRET_KEY:'sk_test_placeholder', STRIPE_WEBHOOK_SECRET:'whsec_placeholder', ...options.env }
  const url = options.url || 'https://www.cafe-sativa.com/api/webhooks/stripe'
  const calls = { admin: 0, signed: 0, secret: null }
  const sub = options.subscription || {
    id: 'sub_1', created:200, status: event.type==='customer.subscription.deleted'?'canceled':'active', metadata: { user_id: 'user_1', site: 'cafe-sativa', tier: 'regular' },
    customer: 'cus_1', items: { data: [{ price: { id: 'price_approved' }, current_period_end: 1800000000 }] }
  }
  const stripe = {
    webhooks: { constructEvent: (_body,_sig,secret) => { calls.signed++; calls.secret=secret; return event } },
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
        const q={eq:()=>q,is:()=>q,select:()=>q,maybeSingle:async()=>({data:{user_id:'user_1'},error:null}),then:resolve=>Promise.resolve({error:null}).then(resolve)};return q
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({data: table==='tickets' ? options.ticket || null : table==='memberships'?{user_id:'user_1',stripe_customer_id:'cus_1',stripe_subscription_id:'sub_1',updated_at:'2026-10-31T00:00:00Z'}:null,error:null}) })
      })
    })
  }
  class StripeMock { constructor() { return stripe } }
  const exports = {}
  const requireMock = name => {
    if (name === 'next/server') return { NextResponse: { json: (body, init={}) => ({status:init.status || 200,body}) } }
    if (name === '@/lib/sync-membership') {const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/sync-membership.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:mod.exports,require:requireMock,Date,Number,Error});return mod.exports}
    if (name === 'stripe') return { __esModule:true,default:StripeMock }
    if (name === '@/lib/supabase/admin') return {createAdminClient:()=>{ calls.admin++; return db }}
    if (name === '@/lib/gallery/environment') return require('./helpers/load-gallery-environment.cjs')(env)
    if (name === '@/lib/gallery/reconcile-refunds') {
      const exports = {}
      vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/gallery/reconcile-refunds.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:requireMock,process:{env},Date,Error})
      return exports
    }
    if (name === '@/lib/membership-prices') return {cafeSubscriptionTier: s => {
      if(s.metadata?.site && s.metadata.site!=='cafe-sativa')return null
      return s.items?.data?.[0]?.price?.id === 'price_approved' ? 'regular' : null
    }}
    throw new Error('Unexpected import '+name)
  }
  vm.runInNewContext(compiled,{exports,require:requireMock,process:{env},URL, console:{log(){},warn(){},error(){}},Date,Number,Error,Promise})
  return {actions,calls,post: () => exports.POST({url,
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
  assert.equal(write.op,'update')
  assert.equal(write.data.status,'canceled')
})

test('foreign subscription never grants membership',async()=>{
  const h=setup({type:'customer.subscription.deleted',data:{object:{
    id:'sub_foreign',status:'active',metadata:{user_id:'user_1',site:'other-site'},
    customer:'cus_1',items:{data:[{price:{id:'price_approved'}}]}
  }}},{subscription:{id:'sub_foreign',metadata:{site:'other-site'},customer:'cus_1',items:{data:[{price:{id:'foreign'}}]}}})
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


const testSite = 'https://gallery-preview.example'
const dedicatedURL = testSite+'/api/gallery/webhook'
const sandboxEnv = {
  VERCEL_ENV:'preview', GALLERY_ISOLATED_TEST:'true',
  STRIPE_SECRET_KEY:'sk_test_synthetic', STRIPE_WEBHOOK_SECRET:'whsec_shared_synthetic',
  GALLERY_TEST_STRIPE_WEBHOOK_SECRET:'whsec_dedicated_synthetic',
  NEXT_PUBLIC_SITE_URL:testSite, NEXT_PUBLIC_SUPABASE_URL:'https://syntheticgallery.supabase.co',
  GALLERY_TEST_SUPABASE_URL:'https://syntheticgallery.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic', SUPABASE_SERVICE_ROLE_KEY:'synthetic',
  GALLERY_INVENTORY_HOLDS:'true', GALLERY_PRIVATE_DOWNLOADS:'true',
}
const galleryEvent = {type:'checkout.session.completed',livemode:false,data:{object:{payment_status:'paid',metadata:{kind:'gallery_order',site:'cafe-sativa'}}}}
test('unconfigured preview rejects Gallery payment before admin initialization',async()=>{
  const h=setup(galleryEvent,{env:{VERCEL_ENV:'preview'},url:testSite+'/api/webhooks/stripe'})
  assert.equal((await h.post()).status,503); assert.equal(h.calls.admin,0);assert.equal(h.actions.length,0)
})
test('dedicated ingress rejects production and shared ingress rejects isolated test config before signature handling',async()=>{
  for(const opts of [{url:'https://www.cafe-sativa.com/api/gallery/webhook'},{env:sandboxEnv,url:testSite+'/api/webhooks/stripe'}]){
    const h=setup(galleryEvent,opts);assert.equal((await h.post()).status,503);assert.equal(h.calls.signed,0);assert.equal(h.calls.admin,0)
  }
})
test('dedicated ingress rejects live events and ignores non-Gallery subscription events',async()=>{
  const live=setup({...galleryEvent,livemode:true},{env:sandboxEnv,url:dedicatedURL})
  assert.equal((await live.post()).status,400);assert.equal(live.calls.admin,0)
  const sub=setup({type:'customer.subscription.deleted',livemode:false,data:{object:{}}},{env:sandboxEnv,url:dedicatedURL})
  assert.equal((await sub.post()).status,200);assert.equal(sub.calls.secret,sandboxEnv.GALLERY_TEST_STRIPE_WEBHOOK_SECRET);assert.equal(sub.calls.admin,0)
})
test('dedicated test refund never updates ticket records; blocked shared refund retains ticket path only',async()=>{
  const event={type:'charge.refunded',livemode:false,data:{object:{payment_intent:'pi_test',refunded:true}}}
  const h=setup(event,{env:sandboxEnv,url:dedicatedURL,ticket:{id:'ticket_1',state:'paid'}})
  assert.equal((await h.post()).status,200);assert.deepEqual(h.actions.map(a=>a.table),['orders'])
  const blocked=setup(event,{env:{VERCEL_ENV:'preview'},url:testSite+'/api/webhooks/stripe',ticket:{id:'ticket_1',state:'paid'}})
  assert.equal((await blocked.post()).status,200);assert.deepEqual(blocked.actions.map(a=>a.table),['tickets'])
})
