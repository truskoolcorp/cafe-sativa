const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const exportsObject={}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/gallery/observe-stripe-settlement.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject})
const observe=exportsObject.observeGallerySettlement
function mock({refund=0,reversed=refund,feeRefund=refund/10,missing=false,live=false,crossCurrency=false,pending=false}={}){
 const charge={id:'ch_fixture',payment_intent:'pi_fixture',livemode:live,paid:true,captured:true,currency:'usd',amount_captured:10000,amount_refunded:refund,transfer:missing?null:'tr_fixture',application_fee:missing?null:'fee_fixture',balance_transaction:'txn_charge'}
 const intent={id:'pi_fixture',livemode:live,status:'succeeded',latest_charge:charge,metadata:{kind:'gallery_order'},currency:'usd',transfer_data:{destination:'acct_fixture'},application_fee_amount:1000}
 return {
  paymentIntents:{retrieve:async()=>intent},
  transfers:{retrieve:async()=>({id:'tr_fixture',livemode:live,destination:'acct_fixture',source_transaction:charge.id,destination_payment:'py_destination',currency:crossCurrency?'eur':'usd',amount:10000,amount_reversed:reversed})},
  applicationFees:{retrieve:async()=>({id:'fee_fixture',livemode:live,account:'acct_fixture',charge:'py_destination',originating_transaction:charge.id,currency:'usd',amount:1000,amount_refunded:feeRefund})},
  balanceTransactions:{retrieve:async id=>id==='txn_charge'?{id,source:charge.id,currency:'usd',amount:10000,fee:320,net:9680,status:'available'}:{id,source:'re_fixture',currency:'usd',amount:-refund,fee:0,net:-refund,status:'available'}},
  refunds:{list:async function*(){if(refund)yield {id:'re_fixture',charge:charge.id,currency:'usd',amount:refund,status:pending?'pending':'succeeded',balance_transaction:pending?null:'txn_refund'}}}
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
