const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const exportsObject={}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/gallery/observe-stripe-settlement.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject,Date})
const observe=exportsObject.observeGallerySettlement
function mock({refund=0,reversed=refund,feeRefund=refund/10,missing=false,live=false,crossCurrency=false,pending=false}={}){
 const charge={id:'ch_fixture',payment_intent:'pi_fixture',livemode:live,paid:true,captured:true,currency:'usd',amount_captured:10000,amount_refunded:refund,transfer:missing?null:'tr_fixture',application_fee:missing?null:'fee_fixture',balance_transaction:'txn_charge'}
 const intent={id:'pi_fixture',livemode:live,status:'succeeded',latest_charge:charge,metadata:{kind:'gallery_order'},currency:'usd',transfer_data:{destination:'acct_fixture'},application_fee_amount:1000}
 return {
  paymentIntents:{retrieve:async()=>intent},
  transfers:{retrieve:async()=>({id:'tr_fixture',livemode:live,destination:'acct_fixture',source_transaction:charge.id,destination_payment:'py_destination',currency:crossCurrency?'eur':'usd',amount:10000,amount_reversed:reversed})},
  applicationFees:{retrieve:async()=>({id:'fee_fixture',livemode:live,account:'acct_fixture',charge:'py_destination',originating_transaction:charge.id,currency:'usd',amount:1000,amount_refunded:feeRefund})},
  balanceTransactions:{retrieve:async id=>id==='txn_charge'?{id,source:charge.id,currency:'usd',amount:10000,fee:320,net:9680,status:'available'}:{id,source:'re_fixture',currency:'usd',amount:-refund,fee:0,net:-refund,status:'available'}},
  refunds:{list:async()=>({has_more:false,data:refund?[{id:'re_fixture',charge:charge.id,currency:'usd',amount:refund,status:pending?'pending':'succeeded',balance_transaction:pending?null:'txn_refund'}]:[]})}
 }
}
test('destination charge: gross transfer less fee is artist allocation, not bank payout',async()=>{
 const x=await observe(mock(),'pi_fixture',false)
 assert.equal(x.transfer_cents,10000);assert.equal(x.observed_artist_connect_allocation_cents,9000);assert.equal(x.observed_platform_application_fee_cents,1000);assert.equal(x.observed_charge_refund_balance_fee_cents,320);assert.equal(x.attention.length,0)
})
test('partial and full refunds distinguish actual transfer reversals and returned application fee',async()=>{
 const x=await observe(mock({refund:2000}),'pi_fixture',false)
 assert.equal(x.observed_artist_connect_allocation_cents,7200);assert.equal(x.observed_platform_application_fee_cents,800);assert.equal(x.observed_charge_refund_balance_fee_cents,320);assert.equal(x.attention.length,0)
 const y=await observe(mock({refund:10000}),'pi_fixture',false)
 assert.equal(y.observed_artist_connect_allocation_cents,0);assert.equal(y.observed_platform_application_fee_cents,0)
 const z=await observe(mock({refund:2000,reversed:0,feeRefund:0}),'pi_fixture',false)
 assert.equal(z.observed_artist_connect_allocation_cents,9000);assert.ok(z.attention.includes('transfer_reversal_mismatch'));assert.ok(z.attention.includes('fee_reversal_review'))
})
test('missing records, pending refunds, mixed currencies, wrong provider mode never become verified split',async()=>{
 const x=await observe(mock({missing:true}),'pi_fixture',false);assert.equal(x.observed_artist_connect_allocation_cents,null);assert.ok(x.attention.includes('missing_connect_records'))
 const y=await observe(mock({refund:2000,pending:true}),'pi_fixture',false);assert.equal(y.observed_charge_refund_balance_fee_cents,null);assert.ok(y.attention.includes('refund_not_final'))
 await assert.rejects(observe(mock({crossCurrency:true}),'pi_fixture',false),/Transfer mismatch/)
 await assert.rejects(observe(mock({live:true}),'pi_fixture',false),/Gallery charge unavailable/)
})

const compare=exportsObject.compareGalleryOrderSettlement
const order={subtotal_cents:10000,total_cents:10000,shipping_cents:0,tax_cents:0,currency:'usd'}
test('independent order 90/10 basis flags wrong intent fee and unreversed split',async()=>{
 const snapshot=await observe(mock({refund:2000}),'pi_fixture',false)
 const result=compare(order,snapshot)
 assert.equal(result.expected_original_commission_cents,1000)
 assert.equal(result.expected_remaining_commission_cents,800)
 assert.equal(result.expected_remaining_artist_cents,7200)
 assert.equal(result.observed_platform_after_charge_refund_fees_cents,480)
 assert.equal(result.attention.length,0)
 const wrong=compare(order,{...snapshot,expected_original_fee_cents:1200,application_fee_cents:1200})
 assert.ok(wrong.attention.includes('order_commission_mismatch'))
 const unreversed=compare(order,await observe(mock({refund:2000,reversed:0,feeRefund:0}),'pi_fixture',false))
 assert.ok(unreversed.attention.includes('order_net_artist_mismatch'))
 assert.ok(unreversed.attention.includes('order_net_commission_mismatch'))
})
test('non-artwork allocation, pending refund and invalid order basis fail closed',async()=>{
 const snapshot=await observe(mock(),'pi_fixture',false)
 assert.equal(compare({...order,subtotal_cents:9000,tax_cents:1000},snapshot).expected_remaining_artist_cents,null)
 assert.equal(compare(order,await observe(mock({refund:2000,pending:true}),'pi_fixture',false)).expected_remaining_artist_cents,null)
 assert.throws(()=>compare({...order,total_cents:9999},snapshot),/basis mismatch/)
 assert.throws(()=>compare({...order,currency:'eur'},snapshot),/basis mismatch/)
})

test('house sale stays on platform without touching Connect and reports processor fees and a refund',async()=>{
 const stripe=mock({refund:2000,missing:true})
 const pi=await stripe.paymentIntents.retrieve()
 pi.metadata.gallery_sale_kind='house'
 pi.transfer_data=null
 pi.application_fee_amount=null
 stripe.transfers.retrieve=()=>{throw Error('Connect API must not run')}
 stripe.applicationFees.retrieve=()=>{throw Error('Connect API must not run')}
 const x=await observe(stripe,'pi_fixture',false,'house')
 assert.equal(x.transfer_id,null)
 assert.equal(x.application_fee_id,null)
 assert.equal(x.attention.length,0)
 assert.equal(compare(order,x).expected_remaining_artist_cents,0)
 assert.equal(compare(order,x).expected_original_commission_cents,0)
 assert.equal(compare(order,x).observed_platform_after_charge_refund_fees_cents,7680)
 await assert.rejects(observe(stripe,'pi_fixture',false),/destination unavailable/)
 pi.transfer_data={destination:'acct_wrong'}
 await assert.rejects(observe(stripe,'pi_fixture',false,'house'),/invalid settlement classification/)
})

test('persisted payment binding rejects unrelated same-value orders and destinations before Connect reads',async()=>{
 const stripe=mock()
 const pi=await stripe.paymentIntents.retrieve()
 Object.assign(pi.metadata,{product_id:'product',artist_id:'artist',user_id:'buyer'})
 const expected={productId:'product',artistId:'artist',buyerId:'buyer',destination:'acct_fixture'}
 assert.equal((await observe(stripe,'pi_fixture',false,'consigned',expected)).attention.length,0)
 stripe.transfers.retrieve=()=>{throw Error('Unbound payment must not read Connect')}
 for(const invalid of [{productId:'other'},{artistId:'other'},{buyerId:'other'},{destination:'acct_other'}])
  await assert.rejects(observe(stripe,'pi_fixture',false,'consigned',{...expected,...invalid}),/order payment binding mismatch/)
})
test('house payment must be bound to its configured account metadata as well as purchased line',async()=>{
 const stripe=mock({missing:true})
 const pi=await stripe.paymentIntents.retrieve()
 Object.assign(pi.metadata,{product_id:'product',artist_id:'studio',user_id:'buyer',gallery_sale_kind:'house',gallery_platform_account_id:'acct_house'})
 pi.transfer_data=null
 pi.application_fee_amount=null
 const expected={productId:'product',artistId:'studio',buyerId:'buyer',destination:null,houseAccountId:'acct_house'}
 assert.equal((await observe(stripe,'pi_fixture',false,'house',expected)).attention.length,0)
 await assert.rejects(observe(stripe,'pi_fixture',false,'house',{...expected,houseAccountId:'acct_wrong'}),/order payment binding mismatch/)
})

function settlementPersistenceFixture(platform, actualAccount='acct_platform', live=false, overrides={},scenario={}){
 const calls={account:0,observe:0,insert:0,rpc:[],stripeOptions:[]}
 const env={STRIPE_SECRET_KEY:live?'sk_live_synthetic':'sk_test_synthetic',GALLERY_SETTLEMENT_OBSERVATIONS:'true',GALLERY_TEST_STRIPE_PLATFORM_ACCOUNT_ID:platform,GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS:'true',GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:platform,NEXT_PUBLIC_SUPABASE_URL:'https://nwfxvhqbjtfvoopcadff.supabase.co',...overrides}
 const order={id:'order',paid_at:'2026-01-01',stripe_payment_intent_id:'pi_fixture',user_id:'buyer',currency:'usd',subtotal_cents:10000,total_cents:10000,shipping_cents:0,tax_cents:0,stripe_checkout_session_id:live?'cs_live_fixture':'cs_test_fixture',...scenario.order}
 const item={gallery_sale_kind:null,product_id:'product',artist_id:'artist',quantity:1,price_cents:10000,line_total_cents:10000,application_fee_cents:1000,transfer_destination:'acct_artist'}
 const db={rpc:async(name,args)=>{
  calls.rpc.push({name,args})
  if(name==='cs_claim_gallery_settlement')return scenario.claim??{data:[],error:null}
  if(name==='cs_finish_gallery_settlement')return scenario.finish??{data:true,error:null}
  if(name==='cs_retry_gallery_settlement')return scenario.retry??{data:true,error:null}
  throw Error('Unexpected RPC')
 },from(table){
  if(table==='orders')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:order})})})}
  if(table==='order_items')return {select:()=>({eq:()=>({limit:async()=>({data:[item]})})})}
  if(table==='gallery_settlement_observations')return {insert:async()=>{calls.insert++;return {error:null}}}
  throw Error('Unexpected table')
 }}
 const out={}
 const mocks={
  stripe:{default:class{constructor(key,options){calls.stripeOptions.push(options);this.accounts={retrieveCurrent:async()=>({id:actualAccount})}}}},
  '@/lib/supabase/admin':{createAdminClient:()=>db},
  '@/lib/gallery/house-checkout':{galleryHouseConfig:()=>null,verifiedGalleryHouseAccount:async(stripe,id,newSale)=>{calls.account++;assert.equal(newSale,false);return (await stripe.accounts.retrieveCurrent()).id===id}},
  '@/lib/gallery/environment':{galleryEnvironment:()=> live?'production':'isolated-test'},
  '@/lib/gallery/observe-stripe-settlement':{observeGallerySettlement:async(stripe,id,providerLive,kind,binding)=>{calls.observe++;if(scenario.observeError)throw Error('Provider unavailable');assert.equal(providerLive,live);assert.equal(kind,'consigned');assert.equal(binding.destination,'acct_artist');return {currency:'usd'}},compareGalleryOrderSettlement:()=>({attention:[]})}
 }
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/gallery/persist-test-settlement.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,require:id=>{if(!mocks[id])throw Error('Unexpected dependency');return mocks[id]},process:{env},URL})
 return {run:()=>out.persistGalleryTestSettlement('http://127.0.0.1:4116','order'),production:(url='https://www.cafe-sativa.com/api/gallery/worker')=>out.persistGalleryProductionSettlement(url,'order'),queue:(url=live?'https://www.cafe-sativa.com/api/gallery/worker':'http://127.0.0.1:4116')=>out.runGallerySettlementQueueOnce(url),calls}
}
test('consigned persistence rejects missing, same-destination or wrong platform before payment reads and writes',async()=>{
 for(const [platform,actual] of [[undefined,'acct_platform'],['invalid','acct_platform'],['acct_artist','acct_artist'],['acct_platform','acct_other']]){
  const h=settlementPersistenceFixture(platform,actual)
  await assert.rejects(h.run(),/Consigned settlement platform mismatch/)
  assert.equal(h.calls.observe,0);assert.equal(h.calls.insert,0)
 }
})
test('consigned persistence binds the verified test platform before observing and appending evidence',async()=>{
 const h=settlementPersistenceFixture('acct_platform')
 await h.run()
 assert.equal(h.calls.account,1);assert.equal(h.calls.observe,1);assert.equal(h.calls.insert,1)
})


test('draft production persistence defaults closed and rejects test mode, wrong origin and database',async()=>{
 for(const [live,overrides,url] of [[false,{},undefined],[true,{GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS:undefined},undefined],[true,{STRIPE_SECRET_KEY:'sk_test_synthetic'},undefined],[true,{GALLERY_ISOLATED_TEST:'true'},undefined],[true,{GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:undefined},undefined],[true,{NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},undefined],[true,{},'https://preview.example.com/api/gallery/worker']]){
  const h=settlementPersistenceFixture('acct_platform','acct_platform',live,overrides)
  await assert.rejects(h.production(url),/Production Gallery settlement/)
  assert.equal(h.calls.account,0);assert.equal(h.calls.observe,0);assert.equal(h.calls.insert,0)
 }
})
test('draft production persistence verifies platform before any provider payment read or persistence',async()=>{
 const wrong=settlementPersistenceFixture('acct_platform','acct_other',true)
 await assert.rejects(wrong.production(),/Consigned settlement platform mismatch/)
 assert.equal(wrong.calls.observe,0);assert.equal(wrong.calls.insert,0)
 const correct=settlementPersistenceFixture('acct_platform','acct_platform',true)
 await correct.production()
 assert.equal(correct.calls.account,1);assert.equal(correct.calls.observe,1);assert.equal(correct.calls.insert,1)
})

// Queued workers must not auto-page provider history or inherit SDK retries.
test('settlement reads have explicit deadlines and zero retries; one complete refund page only',async()=>{
 const stripe=mock({refund:2000});let listCalls=0,reads=0
 for(const [resource,method] of [['paymentIntents','retrieve'],['transfers','retrieve'],['applicationFees','retrieve'],['balanceTransactions','retrieve'],['refunds','list']]){
  const original=stripe[resource][method]
  stripe[resource][method]=async(...args)=>{
   const opts=args.at(-1);assert.ok(opts.timeout>0&&opts.timeout<=3000);assert.equal(opts.maxNetworkRetries,0);reads++
   if(resource==='refunds'){listCalls++;assert.equal(args[0].limit,11);assert.equal(args[0].charge,'ch_fixture')}
   return original(...args)
  }
 }
 const x=await observe(stripe,'pi_fixture',false)
 assert.equal(x.attention.length,0);assert.equal(listCalls,1);assert.equal(reads,6)
})
test('incomplete or oversized refund history and duplicate identities fail before refund balance reads',async()=>{
 const refund={id:'re_fixture',charge:'ch_fixture',currency:'usd',amount:100,status:'succeeded',balance_transaction:'txn_refund'}
 for(const [page,pattern] of [[{has_more:true,data:[refund]},/page incomplete/],[{data:[]},/page incomplete/],[{has_more:false,data:Array.from({length:11},(_,i)=>({...refund,id:'re_'+i}))},/over limit/],[{has_more:false,data:[refund,refund]},/duplicate or invalid/]]){
  const stripe=mock();const original=stripe.balanceTransactions.retrieve;let refundReads=0,listCalls=0
  stripe.balanceTransactions.retrieve=async(id,...args)=>{if(id!=='txn_charge')refundReads++;return original(id,...args)}
  stripe.refunds.list=async()=>{listCalls++;return page}
  await assert.rejects(observe(stripe,'pi_fixture',false),pattern)
  assert.equal(listCalls,1);assert.equal(refundReads,0)
 }
})

test('whole observation deadline stops subsequent reads and rejects a late final response',async()=>{
 const originalNow=Date.now
 let now=1000
 try{
  Date.now=()=>now
  const early=mock()
  const readIntent=early.paymentIntents.retrieve
  let downstream=0
  early.paymentIntents.retrieve=async(...args)=>{const value=await readIntent(...args);now+=20_000;return value}
  early.transfers.retrieve=async()=>{downstream++;throw Error('Unexpected downstream read')}
  await assert.rejects(observe(early,'pi_fixture',false),/observation deadline exceeded/)
  assert.equal(downstream,0)
  now=1000
  const late=mock()
  const list=late.refunds.list
  late.refunds.list=async(...args)=>{const value=await list(...args);now+=20_000;return value}
  await assert.rejects(observe(late,'pi_fixture',false),/observation deadline exceeded/)
 }finally{Date.now=originalNow}
})

const queueLease={order_id:'c0000000-0000-4000-8000-000000000001',generation:2,lease_token:'c0000000-0000-4000-8000-000000000002'}
const queueOn={GALLERY_SETTLEMENT_QUEUE_ENABLED:'true'}
const leased={claim:{data:[queueLease],error:null},order:{id:queueLease.order_id}}
test('draft queue rejects disabled, wrong origin or mismatched platform before claiming or observing',async()=>{
 const disabled=settlementPersistenceFixture('acct_platform')
 await assert.rejects(disabled.queue(),/queue disabled/)
 const wrong=settlementPersistenceFixture('acct_platform','acct_other',false,queueOn)
 await assert.rejects(wrong.queue(),/platform mismatch/)
 const wrongOrigin=settlementPersistenceFixture('acct_platform','acct_platform',true,queueOn)
 await assert.rejects(wrongOrigin.queue('https://preview.example.com/api/gallery/worker'),/environment mismatch/)
 for(const h of [disabled,wrong,wrongOrigin]){
  assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.observe,0);assert.equal(h.calls.insert,0)
 }
})
test('one claimed settlement lease is finished through CAS only, never direct insertion',async()=>{
 for(const live of [false,true]){
  const h=settlementPersistenceFixture('acct_platform','acct_platform',live,queueOn,leased)
  assert.equal((await h.queue()).status,'recorded')
  assert.equal(h.calls.account,1);assert.equal(h.calls.observe,1);assert.equal(h.calls.insert,0)
  assert.equal(h.calls.stripeOptions[0].timeout,3000);assert.equal(h.calls.stripeOptions[0].maxNetworkRetries,0)
  const [claim,finish]=h.calls.rpc
  assert.equal(h.calls.rpc.length,2);assert.equal(claim.name,'cs_claim_gallery_settlement');assert.equal(claim.args.p_limit,1)
  assert.equal(finish.name,'cs_finish_gallery_settlement');assert.equal(finish.args.p_live,live)
  assert.equal(finish.args.p_order,queueLease.order_id);assert.equal(finish.args.p_generation,2)
  assert.equal(finish.args.p_lease,queueLease.lease_token);assert.equal(finish.args.p_snapshot.currency,'usd')
 }
})
test('queue idle and malformed claims never observe or mutate an unrelated order',async()=>{
 const idle=settlementPersistenceFixture('acct_platform','acct_platform',false,queueOn)
 assert.equal((await idle.queue()).status,'idle');assert.equal(idle.calls.rpc.length,1)
 for(const data of [[queueLease,queueLease],[{...queueLease,lease_token:'bad'}],[{...queueLease,generation:0}],null]){
  const h=settlementPersistenceFixture('acct_platform','acct_platform',false,queueOn,{claim:{data,error:null}})
  await assert.rejects(h.queue(),/claim failed|lease invalid/)
  assert.equal(h.calls.rpc.length,1);assert.equal(h.calls.observe,0);assert.equal(h.calls.insert,0)
 }
})
test('same-mode order binding and incomplete evidence retry through the lease only',async()=>{
 const cases=[
  {...leased,order:{...leased.order,stripe_checkout_session_id:'cs_live_fixture'}},
  {...leased,order:{...leased.order,id:'other'}},
  {...leased,observeError:true},
  {...leased,finish:{data:null,error:{message:'invalid evidence'}}}
 ]
 for(const [i,scenario] of cases.entries()){
  const h=settlementPersistenceFixture('acct_platform','acct_platform',false,queueOn,scenario)
  assert.equal((await h.queue()).status,'retry_or_review')
  assert.equal(h.calls.observe,i<2?0:1);assert.equal(h.calls.insert,0)
  const retry=h.calls.rpc.at(-1)
  assert.equal(retry.name,'cs_retry_gallery_settlement');assert.equal(retry.args.p_generation,2)
  assert.equal(retry.args.p_lease,queueLease.lease_token);assert.equal(retry.args.p_reason,'evidence_retry')
 }
})
test('lost finish response or superseded lease cannot cause a second observation',async()=>{
 for(const scenario of [{...leased,finish:{data:false,error:null}},{...leased,finish:{data:null,error:{message:'transport'}},retry:{data:false,error:null}}]){
  const h=settlementPersistenceFixture('acct_platform','acct_platform',false,queueOn,scenario)
  assert.equal((await h.queue()).status,'stale')
  assert.equal(h.calls.observe,1);assert.equal(h.calls.insert,0)
  assert.equal(h.calls.rpc.filter(r=>r.name==='cs_finish_gallery_settlement').length,1)
 }
})

const productionWorkerSource=ts.transpileModule(fs.readFileSync('app/api/gallery/settlement-worker/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function productionSettlementWorker({overrides={},mode='production',url='https://www.cafe-sativa.com/api/gallery/settlement-worker',authorization='Bearer '+('p'.repeat(48)),body=null,workerError=false}={}){
 const secret='p'.repeat(48)
 const env={VERCEL_ENV:'production',GALLERY_PRODUCTION_SETTLEMENT_WORKER:'true',GALLERY_SETTLEMENT_QUEUE_ENABLED:'true',GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS:'true',GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET:secret,GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:'acct_fixture',STRIPE_SECRET_KEY:'sk_live_synthetic',NEXT_PUBLIC_SUPABASE_URL:'https://nwfxvhqbjtfvoopcadff.supabase.co',GALLERY_SALES_ENABLED:'false',...overrides}
 let calls=0
 const ctx={exports:{},URL,Response,Buffer,process:{env},require(id){
  if(id==='node:crypto')return require(id)
  if(id.endsWith('/environment'))return {...require('./helpers/load-gallery-environment.cjs')(env),galleryEnvironment:()=>mode}
  if(id.endsWith('/persist-test-settlement'))return {runGallerySettlementQueueOnce:async()=>{calls++;if(workerError)throw Error('private provider error');return {status:'recorded',private:'not returned'}}}
  throw Error(id)
 }}
 vm.runInNewContext(productionWorkerSource,ctx)
 return {calls:()=>calls,post:async()=>{const r=await ctx.exports.POST(new Request(url,{method:'POST',headers:authorization?{authorization}:{},body}));return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')}}}
}
test('draft production settlement worker defaults off and rejects wrong mode, host, database, shared secret or caller-selected work',async()=>{
 for(const o of [{overrides:{GALLERY_PRODUCTION_SETTLEMENT_WORKER:undefined}},{overrides:{GALLERY_SETTLEMENT_QUEUE_ENABLED:undefined}},{overrides:{GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS:undefined}},{overrides:{VERCEL_ENV:'preview'}},{overrides:{VERCEL_ENV:undefined}},{overrides:{GALLERY_ISOLATED_TEST:'true'}},{overrides:{GALLERY_SETTLEMENT_QA_ENDPOINT:'true'}},{overrides:{STRIPE_SECRET_KEY:'sk_test_synthetic'}},{overrides:{GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:undefined}},{mode:'isolated-test'},{mode:'blocked'},{overrides:{NEXT_PUBLIC_SUPABASE_URL:'https://anrprovgdpwqcalkolsz.supabase.co'}},{overrides:{CRON_SECRET:'p'.repeat(48)}},{overrides:{GALLERY_SETTLEMENT_QA_SECRET:'p'.repeat(48)}},{overrides:{GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET:'short'}},{url:'https://www.cafe-sativa.com/api/gallery/settlement-worker?order=other'},{url:'https://www.cafe-sativa.com/api/gallery/worker'},{url:'https://preview.example.com/api/gallery/settlement-worker'}]){
  const h=productionSettlementWorker(o);assert.equal((await h.post()).status,404);assert.equal(h.calls(),0)
 }
})
test('draft production settlement worker requires separate bearer and empty body; new sales off does not block existing settlement',async()=>{
 for(const [o,s] of [[{authorization:''},401],[{authorization:'Bearer '+('q'.repeat(48))},401],[{body:'{"order":"other"}'},400]]){
  const h=productionSettlementWorker(o);assert.equal((await h.post()).status,s);assert.equal(h.calls(),0)
 }
 const h=productionSettlementWorker(),r=await h.post();assert.equal(r.status,200);assert.deepEqual(r.body,{status:'recorded'});assert.equal(r.cache,'private, no-store');assert.equal(h.calls(),1)
 const bad=productionSettlementWorker({workerError:true}),failure=await bad.post();assert.equal(failure.status,503);assert.equal(bad.calls(),1);assert.equal(failure.body.error,'Gallery settlement worker unavailable')
})

const fulfillmentWorkerSource=ts.transpileModule(fs.readFileSync('app/api/gallery/worker/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function fulfillmentWorker({overrides={},url='https://www.cafe-sativa.com/api/gallery/worker',authorization='Bearer '+('f'.repeat(48)),body=null,accountMatches=true}={}){
 const env={VERCEL_ENV:'production',GALLERY_DIGITAL_WORKER:'true',GALLERY_PRIVATE_DOWNLOADS:'true',GALLERY_INVENTORY_HOLDS:'true',GALLERY_PRODUCTION_FULFILLMENT_WORKER_SECRET:'f'.repeat(48),GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET:'p'.repeat(48),GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:'acct_fixture',GALLERY_HOUSE_STRIPE_ACCOUNT_ID:'acct_fixture',STRIPE_SECRET_KEY:'sk_live_synthetic',NEXT_PUBLIC_SITE_URL:'https://www.cafe-sativa.com',NEXT_PUBLIC_SUPABASE_URL:'https://nwfxvhqbjtfvoopcadff.supabase.co',GALLERY_SALES_ENABLED:'false',...overrides}
 const calls=[]
 const ctx={exports:{},URL,Response,Buffer,process:{env},require(id){
  if(id==='node:crypto')return require(id)
  if(id==='stripe')return {default:class {}}
  if(id.endsWith('/environment'))return require('./helpers/load-gallery-environment.cjs')(env)
  if(id.endsWith('/house-checkout'))return {verifiedGalleryHouseAccount:async()=>{calls.push('account');return accountMatches}}
  if(id.endsWith('/fulfill-digital'))return {authorizeStagedDigitalOrders:async()=>{calls.push('fulfillment');return {authorized:1}}}
  if(id.endsWith('/send-delivery-notices'))return {sendGalleryDeliveryNotices:async()=>{calls.push('notices');return {sent:0}}}
  if(id.endsWith('/reconcile-inventory'))return {reconcileGalleryInventory:async()=>{calls.push('inventory');return {released:0}}}
  throw Error(id)
 }}
 vm.runInNewContext(fulfillmentWorkerSource,ctx)
 return {calls,exports:ctx.exports,post:async()=>{const r=await ctx.exports.POST(new Request(url,{method:'POST',headers:authorization?{authorization}:{},body}));return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')}}}
}
test('Gallery fulfillment worker is POST-only, separately credentialed, and independent of new sales',async()=>{
 for(const o of [{overrides:{GALLERY_DIGITAL_WORKER:undefined}},{overrides:{GALLERY_PRIVATE_DOWNLOADS:'false'}},{overrides:{GALLERY_PRODUCTION_FULFILLMENT_WORKER_SECRET:undefined}},{overrides:{GALLERY_PRODUCTION_FULFILLMENT_WORKER_SECRET:'p'.repeat(48)}},{overrides:{CRON_SECRET:'f'.repeat(48)}},{overrides:{STRIPE_SECRET_KEY:'sk_test_synthetic'}},{overrides:{NEXT_PUBLIC_SUPABASE_URL:'https://anrprovgdpwqcalkolsz.supabase.co'}},{overrides:{GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:'acct_other'}},{overrides:{GALLERY_ISOLATED_TEST:'true'}},{url:'https://preview.example.com/api/gallery/worker'},{url:'https://www.cafe-sativa.com/api/gallery/worker?order=other'}]){
  const h=fulfillmentWorker(o);assert.equal((await h.post()).status,404);assert.deepEqual(h.calls,[])
 }
 for(const [o,s] of [[{authorization:''},401],[{authorization:'Bearer '+('p'.repeat(48))},401],[{body:'{"order":"other"}'},400]]){
  const h=fulfillmentWorker(o);assert.equal((await h.post()).status,s);assert.deepEqual(h.calls,[])
 }
 const wrong=fulfillmentWorker({accountMatches:false});assert.equal((await wrong.post()).status,503);assert.deepEqual(wrong.calls,['account'])
 const h=fulfillmentWorker();assert.equal(h.exports.GET,undefined);const r=await h.post();assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');assert.deepEqual(h.calls,['account','fulfillment','notices','inventory'])
})
test('Gallery fulfillment test route accepts only isolated literal-loopback runtime and never invokes notices',async()=>{
 const site='http://127.0.0.1:4116',db='http://127.0.0.1:54321'
 const overrides={VERCEL_ENV:undefined,GALLERY_ISOLATED_TEST:'true',GALLERY_TEST_FULFILLMENT_WORKER_SECRET:'t'.repeat(48),STRIPE_SECRET_KEY:'sk_test_synthetic',GALLERY_TEST_STRIPE_WEBHOOK_SECRET:'whsec_fixture',GALLERY_TEST_STRIPE_PLATFORM_ACCOUNT_ID:'acct_fixture',NEXT_PUBLIC_SITE_URL:site,NEXT_PUBLIC_SUPABASE_URL:db,GALLERY_TEST_SUPABASE_URL:db,NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon_fixture',SUPABASE_SERVICE_ROLE_KEY:'service_fixture'}
 const options={overrides,url:site+'/api/gallery/worker',authorization:'Bearer '+('t'.repeat(48))}
 const h=fulfillmentWorker(options),r=await h.post();assert.equal(r.status,200);assert.equal(r.body.notifications.enabled,false);assert.deepEqual(h.calls,['account','fulfillment','inventory'])
 for(const change of [{GALLERY_DELIVERY_NOTICES:'true'},{VERCEL_ENV:'preview'},{GALLERY_TEST_FULFILLMENT_WORKER_SECRET:'p'.repeat(48)},{GALLERY_TEST_STRIPE_PLATFORM_ACCOUNT_ID:undefined}]){
  const bad=fulfillmentWorker({...options,overrides:{...overrides,...change}});assert.equal((await bad.post()).status,404);assert.deepEqual(bad.calls,[])
 }
})
