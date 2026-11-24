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
