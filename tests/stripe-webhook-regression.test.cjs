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
  const calls = { admin: 0, signed: 0, secret: null, refundLists: 0, reads: [] }
  const sub = options.subscription || {
    id: 'sub_1', created:200, status: event.type==='customer.subscription.deleted'?'canceled':'active', metadata: { user_id: 'user_1', site: 'cafe-sativa', tier: 'regular' },
    customer: 'cus_1', items: { data: [{ price: { id: 'price_approved' }, current_period_end: 1800000000 }] }
  }
  const stripe = {
    webhooks: { constructEvent: (_body,_sig,secret) => { calls.signed++; calls.secret=secret; return event } },
    subscriptions: { retrieve: async () => sub },
    checkout: { sessions: { listLineItems: async () => ({ data: options.lines ?? [], has_more: false }) } },
    paymentIntents: { retrieve: async () => options.intent ?? ({ application_fee_amount: 0 }) },
    accounts: { retrieveCurrent: async () => ({ id: options.accountId }) },
    refunds: { list: async function* () { calls.refundLists++; if(options.refundListError)throw Error('synthetic refund list outage'); yield* (options.refunds || []) } }
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
        const q={eq:()=>q,is:()=>q,select:()=>q,maybeSingle:async()=>({data:{user_id:'user_1'},error:null}),then:resolve=>Promise.resolve({error:table==='orders'&&options.orderUpdateError||table==='tickets'&&options.ticketUpdateError||null}).then(resolve)};return q
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => {
          calls.reads.push(table)
          return {data: table==='products' ? options.product || null : table==='tickets' ? options.ticket || null : table==='orders' ? options.order || null : table==='memberships'?{user_id:'user_1',stripe_customer_id:'cus_1',stripe_subscription_id:'sub_1',updated_at:'2026-10-31T00:00:00Z'}:null,error:table==='tickets'&&options.ticketLookupError||table==='orders'&&options.orderLookupError||null}
        } })
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
    if (name === '@/lib/gallery/house-checkout') {
      const exports = {}
      vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/gallery/house-checkout.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,process:{env}})
      return exports
    }
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

const refundEvent = (full=true) => ({type:'charge.refunded',livemode:false,data:{object:{id:'ch_1',payment_intent:'pi_1',currency:'usd',amount_captured:1200,amount_refunded:full?1200:100,refunded:full}}})
const galleryRefundOrder={id:'order_1',currency:'usd',total_cents:1200}
const refundReceipt=(overrides={})=>({id:'re_1',charge:'ch_1',payment_intent:'pi_1',currency:'usd',amount:100,status:'succeeded',...overrides})
test('ticket refund is independent of Gallery DB and provider failures',async()=>{
  const h=setup(refundEvent(),{ticket:{id:'ticket_1',state:'paid'},env:{GALLERY_REFUND_LEDGER:'true'},orderUpdateError:'missing orders',orderLookupError:'missing Gallery schema',refundListError:true})
  assert.equal((await h.post()).status,200)
  assert.deepEqual(h.actions.map(a=>a.table),['tickets'])
  assert.equal(h.actions[0].data.state,'refunded')
  assert.deepEqual(h.calls.reads,['tickets'])
  assert.equal(h.calls.refundLists,0)
})
test('ticket refund replay and partial refund never enter Gallery ledger',async()=>{
  for(const [full,state] of [[true,'refunded'],[false,'paid']]){
    const h=setup(refundEvent(full),{ticket:{id:'ticket_1',state},env:{GALLERY_REFUND_LEDGER:'true'},orderLookupError:'missing Gallery schema'})
    assert.equal((await h.post()).status,200)
    assert.equal(h.actions.length,0)
    assert.deepEqual(h.calls.reads,['tickets'])
    assert.equal(h.calls.refundLists,0)
  }
})
test('ticket lookup or update outage stays retryable without Gallery writes',async()=>{
  for(const opts of [{ticketLookupError:'lookup unavailable'},{ticket:{id:'ticket_1',state:'paid'},ticketUpdateError:'update unavailable'}]){
    const h=setup(refundEvent(),opts)
    assert.equal((await h.post()).status,500)
    assert.equal(h.actions.some(a=>a.table==='orders'),false)
  }
})
test('Gallery full refund revokes access even when ledger provider lookup fails and remains retryable',async()=>{
  const h=setup(refundEvent(),{order:galleryRefundOrder,env:{GALLERY_REFUND_LEDGER:'true'},refundListError:true})
  assert.equal((await h.post()).status,500)
  assert.deepEqual(h.actions.map(a=>a.table),['orders'])
  assert.equal(h.actions[0].data.fulfillment_state,'refunded')
  assert.equal(h.calls.refundLists,1)
})
test('Gallery partial refund records evidence without revoking fulfillment or restocking',async()=>{
  const h=setup(refundEvent(false),{order:galleryRefundOrder,env:{GALLERY_REFUND_LEDGER:'true'},refunds:[refundReceipt()]})
  assert.equal((await h.post()).status,200)
  assert.deepEqual(h.actions.map(a=>a.table),['gallery_refund_receipts'])
  assert.equal(h.actions[0].data[0].amount_cents,100)
})
test('Gallery refund rejects foreign, duplicate or invalid receipts before any ledger write',async()=>{
  for(const invalid of [refundReceipt({id:'re_2',charge:'ch_foreign'}),refundReceipt({id:'re_2',payment_intent:'pi_foreign'}),refundReceipt({id:'re_2',amount:0.5}),refundReceipt({id:'re_2',amount:1200}),refundReceipt()]){
    const h=setup(refundEvent(false),{order:galleryRefundOrder,env:{GALLERY_REFUND_LEDGER:'true'},refunds:[refundReceipt(),invalid]})
    assert.equal((await h.post()).status,500)
    assert.equal(h.actions.length,0)
  }
})
test('Gallery old partial refund event reads current receipts in one ledger batch',async()=>{
  const h=setup(refundEvent(false),{order:galleryRefundOrder,env:{GALLERY_REFUND_LEDGER:'true'},refunds:[refundReceipt(),refundReceipt({id:'re_2',amount:1100})]})
  assert.equal((await h.post()).status,200)
  assert.equal(h.actions.length,1)
  assert.equal(h.actions[0].data.length,2)
  assert.equal(h.actions[0].data.reduce((sum,r)=>sum+r.amount_cents,0),1200)
})
test('Gallery full refund records evidence only after order revocation succeeds',async()=>{
  const h=setup(refundEvent(),{order:galleryRefundOrder,env:{GALLERY_REFUND_LEDGER:'true'},orderUpdateError:'order unavailable'})
  assert.equal((await h.post()).status,500)
  assert.equal(h.calls.refundLists,0)
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

function houseEvent() {
 const product='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', artist='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 const ids={kind:'gallery_order',site:'cafe-sativa',user_id:'user_1',product_id:product,artist_id:artist,
   gallery_sale_kind:'house',gallery_platform_account_id:'acct_house'}
 const session={id:'cs_house',mode:'payment',currency:'usd',payment_status:'paid',amount_total:1200,
   livemode:true,payment_intent:'pi_house',metadata:{...ids,quantity:'1',
     inventory_hold_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',approved_asset_id:'approved_edition'}}
 return [{type:'checkout.session.completed',livemode:true,data:{object:session}},{
   env:{GALLERY_HOUSE_PRODUCT_ID:product,GALLERY_HOUSE_ARTIST_ID:artist,GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_house',
        GALLERY_HOUSE_CHECKOUT_ENABLED:'false'}, // existing paid events must finish with new sales off
   product:{id:product,kind:'digital'},accountId:'acct_house',
   lines:[{quantity:1,amount_subtotal:1200,currency:'usd'}],
   intent:{id:'pi_house',status:'succeeded',currency:'usd',livemode:true,amount:1200,amount_received:1200,
     metadata:{...ids},application_fee_amount:null,transfer_data:null,on_behalf_of:null},
   rpcResult:{id:'order_house',created:false}
 }]
}
test('house paid receipt is persisted without fee or separate entitlement write while new sales disabled',async()=>{
 const h=setup(...houseEvent())
 assert.equal((await h.post()).status,200)
 assert.equal(h.actions.length,1)
 const a=h.actions[0]
 assert.equal(a.name,'cs_record_house_gallery_payment')
 assert.equal(a.input.receipt.application_fee_cents,0)
 assert.equal(a.input.p_asset,'approved_edition')
})
test('house event with wrong key account, Connect destination, or inconsistent classification makes no writes',async()=>{
 for(const modify of [
  (e,o)=>o.accountId='acct_wrong',
  (e,o)=>o.intent.transfer_data={destination:'acct_wrong'},
  (e,o)=>o.intent.application_fee_amount=120,
  (e,o)=>delete e.data.object.metadata.gallery_sale_kind,
  (e,o)=>delete e.data.object.metadata.approved_asset_id,
  (e,o)=>o.intent.amount_received=1000,
  (e,o)=>o.intent.livemode=false
 ]){
  const [e,o]=houseEvent();modify(e,o)
  const h=setup(e,o)
  assert.equal((await h.post()).status,500)
  assert.equal(h.actions.length,0)
 }
})

test('temporary sandbox webhook processes only the exact house flow and refunds',async()=>{
 const url='http://127.0.0.1:4116/api/gallery/webhook',app='http://127.0.0.1:4116',db='http://127.0.0.1:54321'
 for(const kind of ['house','consigned','account.updated','charge.refunded']){
  const [event,opts]=houseEvent()
  event.livemode=false;event.data.object.livemode=false;opts.intent.livemode=false
  opts.url=url
  Object.assign(opts.env,{VERCEL_ENV:undefined,GALLERY_LOCAL_STRIPE_CLI:'true',GALLERY_ISOLATED_TEST:'true',
   STRIPE_SECRET_KEY:'rkcs_test_SYNTHETIC_NOT_A_KEY',GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID:'acct_house',
   GALLERY_TEST_STRIPE_WEBHOOK_SECRET:'whsec_synthetic_anonymous',NEXT_PUBLIC_SITE_URL:app,
   NEXT_PUBLIC_SUPABASE_URL:db,GALLERY_TEST_SUPABASE_URL:db,NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',
   SUPABASE_SERVICE_ROLE_KEY:'service',GALLERY_INVENTORY_HOLDS:'true',GALLERY_PRIVATE_DOWNLOADS:'true'})
  if(kind==='consigned') delete event.data.object.metadata.gallery_sale_kind
  if(kind==='account.updated') event.type=kind
  if(kind==='charge.refunded'){event.type=kind;event.data.object={id:'ch_synthetic',payment_intent:'pi_house',refunded:true}}
  const h=setup(event,opts)
  assert.equal((await h.post()).status,200)
  assert.equal(h.actions.length,['house','charge.refunded'].includes(kind)?1:0)
  if(kind==='house') assert.equal(h.actions[0].name,'cs_record_house_gallery_payment')
  if(kind==='charge.refunded'){assert.equal(h.actions[0].table,'orders');assert.equal(h.actions[0].data.fulfillment_state,'refunded')}
 }
})

function consignedPrivateEvent() {
 const ids={kind:'gallery_order',site:'cafe-sativa',user_id:'user_1',
   product_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',artist_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   gallery_private_schema:'consigned-v1',gallery_transfer_destination:'acct_FixtureArtist',
   inventory_hold_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',approved_asset_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}
 const session={id:'cs_private',mode:'payment',currency:'usd',payment_status:'paid',amount_total:1249,
   livemode:true,payment_intent:'pi_private',metadata:{...ids,quantity:'1'}}
 return [{type:'checkout.session.completed',livemode:true,data:{object:session}},{
   product:{id:ids.product_id,kind:'digital',digital_delivery_url:null},
   lines:[{quantity:1,amount_subtotal:1249,currency:'usd'}],
   intent:{id:'pi_private',status:'succeeded',currency:'usd',livemode:true,amount:1249,amount_received:1249,
     metadata:{...ids},application_fee_amount:124,transfer_data:{destination:'acct_FixtureArtist'},on_behalf_of:null},
   rpcResult:{id:'order_private',created:false}
 }]
}
test('private consigned paid receipt goes directly to atomic order and edition without legacy URL',async()=>{
 const h=setup(...consignedPrivateEvent())
 assert.equal((await h.post()).status,200)
 assert.equal(h.actions.length,1)
 const a=h.actions[0]
 assert.equal(a.name,'cs_record_consigned_private_gallery_payment')
 assert.equal(a.input.receipt.application_fee_cents,124)
 assert.equal(a.input.receipt.transfer_destination,'acct_FixtureArtist')
 assert.equal(a.input.p_asset,'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
})
test('private consigned marker, account, asset, fee and amount mismatches do not write',async()=>{
 for(const modify of [
  (e,o)=>delete e.data.object.metadata.gallery_private_schema,
  (e,o)=>delete o.intent.metadata.gallery_private_schema,
  (e,o)=>o.intent.transfer_data.destination='acct_Wrong',
  (e,o)=>o.intent.metadata.approved_asset_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  (e,o)=>o.intent.application_fee_amount=125,
  (e,o)=>o.intent.amount_received=1000,
  (e,o)=>o.intent.livemode=false,
  (e,o)=>o.product.kind='physical'
 ]){
  const [e,o]=consignedPrivateEvent();modify(e,o)
  const h=setup(e,o)
  assert.equal((await h.post()).status,500)
  assert.equal(h.actions.length,0)
 }
})
