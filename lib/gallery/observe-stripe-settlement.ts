import type Stripe from 'stripe'

const idOf = (value: string | {id:string} | null | undefined) =>
 typeof value === 'string' ? value : value?.id ?? null

/** Read-only observation of destination charges, never a bank payout statement.
 * Stripe transfers gross and separately returns the application fee to the platform.
 * Unknown provider records or cross-currency settlements cannot establish a net split.
 */
type OrderBinding = {productId:string,artistId:string,buyerId:string,destination:string|null,houseAccountId?:string}

/** When persisted, bind the provider payment to the immutable purchased line,
 * not today's artist payout settings or merely a matching amount/currency. */
export async function observeGallerySettlement(stripe:Stripe,paymentIntentId:string,expectedLive:boolean,expectedSaleKind:'consigned'|'house'='consigned',binding?:OrderBinding){
 // Preserve the whole-observation deadline from the ordinary Gallery draft,
 // as well as the queue's strict prevalidation of refund identities.
 const deadline=Date.now()+20_000
 const requestOptions=():Stripe.RequestOptions=>{
  const remaining=deadline-Date.now()
  if(remaining<=0)throw Error('Gallery settlement observation deadline exceeded')
  return {timeout:Math.min(3000,remaining),maxNetworkRetries:0}
 }
 const intent=await stripe.paymentIntents.retrieve(paymentIntentId,{expand:['latest_charge']},requestOptions())
 const charge=intent.latest_charge
 if(intent.id!==paymentIntentId||intent.livemode!==expectedLive||intent.status!=='succeeded'||
   !charge||typeof charge==='string'||charge.livemode!==expectedLive||!charge.paid||
   !charge.captured||idOf(charge.payment_intent)!==intent.id||
   intent.metadata?.kind!=='gallery_order'||charge.currency!==intent.currency)throw Error('Gallery charge unavailable')
 const transferId=idOf(charge.transfer),feeId=idOf(charge.application_fee)
 const destination=idOf(intent.transfer_data?.destination)
 const house=expectedSaleKind==='house'
 if(binding&&(
   intent.metadata?.product_id!==binding.productId||
   intent.metadata?.artist_id!==binding.artistId||
   intent.metadata?.user_id!==binding.buyerId||
   destination!==binding.destination||
   (house&&(!binding.houseAccountId||intent.metadata?.gallery_platform_account_id!==binding.houseAccountId))
 ))throw Error('Gallery order payment binding mismatch')
 if(house){
  if(intent.metadata?.gallery_sale_kind!=='house'||intent.transfer_data||intent.on_behalf_of||
    (intent.application_fee_amount!==null&&intent.application_fee_amount!==0)||transferId||feeId)
   throw Error('House charge has invalid settlement classification')
 }else if(!destination||intent.metadata?.gallery_sale_kind)throw Error('Gallery destination unavailable')
 const [transfer,fee]=await Promise.all([
  transferId?stripe.transfers.retrieve(transferId,{},requestOptions()):Promise.resolve(null),
  feeId?stripe.applicationFees.retrieve(feeId,{},requestOptions()):Promise.resolve(null)
 ])
 if(transfer&&(transfer.id!==transferId||transfer.livemode!==expectedLive||
   transfer.currency!==charge.currency||idOf(transfer.destination)!==destination||
   idOf(transfer.source_transaction)!==charge.id))throw Error('Transfer mismatch')
 if(fee&&(fee.id!==feeId||fee.livemode!==expectedLive||fee.currency!==charge.currency||
   idOf(fee.account)!==destination||
   (idOf(fee.originating_transaction)!==charge.id &&
    !(transfer&&idOf(transfer.destination_payment)&&idOf(fee.charge)===idOf(transfer.destination_payment)))||
   typeof fee.amount_refunded!=='number'))throw Error('Application fee mismatch')
 const readBalance=async (value:string|Stripe.BalanceTransaction|null,source:string)=>{
  const id=idOf(value)
  if(!id)return null
  const b=await stripe.balanceTransactions.retrieve(id,{},requestOptions())
  if(b.id!==id||idOf(b.source)!==source||b.currency!==charge.currency||
   b.amount-b.fee!==b.net)throw Error('Balance transaction mismatch')
  return {id:b.id,amount_cents:b.amount,fee_cents:b.fee,net_cents:b.net,status:b.status}
 }
 const chargeBalance=await readBalance(charge.balance_transaction,charge.id)
 if(chargeBalance&&chargeBalance.amount_cents!==charge.amount_captured)throw Error('Captured amount mismatch')
 // A complete bounded page is required; larger histories remain retry/review work.
 const page=await stripe.refunds.list({charge:charge.id,limit:11},requestOptions())
 if(page.has_more!==false||!Array.isArray(page.data)||page.data.length>10)
  throw Error('Gallery refund page incomplete or over limit')
 const seenRefunds=new Set<string>()
 for(const refund of page.data){
  if(typeof refund.id!=='string'||!refund.id||seenRefunds.has(refund.id))throw Error('Gallery duplicate or invalid refund identity')
  seenRefunds.add(refund.id)
 }
 const refunds=[]
 for(const refund of page.data){
  if(idOf(refund.charge)!==charge.id||refund.currency!==charge.currency||
    !Number.isSafeInteger(refund.amount)||refund.amount<=0)throw Error('Refund mismatch')
  const balance=refund.status==='succeeded'?await readBalance(refund.balance_transaction,refund.id):null
  if(balance&&balance.amount_cents!==-refund.amount)throw Error('Refund balance mismatch')
  refunds.push({id:refund.id,amount_cents:refund.amount,status:refund.status??'unknown',balance})
 }
 if(Date.now()>=deadline)throw Error('Gallery settlement observation deadline exceeded')
 const succeeded=refunds.filter(r=>r.status==='succeeded')
 const succeededTotal=succeeded.reduce((n,r)=>n+r.amount_cents,0)
 const netFee=fee?fee.amount-fee.amount_refunded:null
 const netTransfer=transfer?transfer.amount-transfer.amount_reversed:null
 const providerFees=chargeBalance&&succeeded.every(r=>r.balance!==null)&&succeededTotal===charge.amount_refunded
  ?chargeBalance.fee_cents+succeeded.reduce((n,r)=>n+(r.balance?.fee_cents??0),0):null
 const actualArtist=netFee!==null&&netTransfer!==null?netTransfer-netFee:null
 const attention:string[]=[]
 if(!house&&(!transfer||!fee))attention.push('missing_connect_records')
 if(transfer&&transfer.amount!==charge.amount_captured)attention.push('gross_transfer_mismatch')
 if(fee&&fee.amount!==intent.application_fee_amount)attention.push('application_fee_mismatch')
 if(succeededTotal!==charge.amount_refunded||refunds.some(r=>!['succeeded','failed','canceled'].includes(r.status)))attention.push('refund_not_final')
 if(providerFees===null)attention.push('balance_transactions_incomplete')
 if(transfer&&transfer.amount_reversed!==succeededTotal)attention.push('transfer_reversal_mismatch')
 if(fee&&charge.amount_captured>0&&fee.amount_refunded!==Math.floor(fee.amount*succeededTotal/charge.amount_captured))attention.push('fee_reversal_review')
 return {
  payment_intent_id:intent.id,charge_id:charge.id,currency:charge.currency,livemode:expectedLive,
  captured_cents:charge.amount_captured,refunded_cents:charge.amount_refunded,sale_kind:expectedSaleKind,
  expected_original_fee_cents:intent.application_fee_amount,
  transfer_id:transfer?.id??null,transfer_cents:transfer?.amount??null,
  transfer_reversed_cents:transfer?.amount_reversed??null,
  application_fee_id:fee?.id??null,application_fee_cents:fee?.amount??null,
  application_fee_refunded_cents:fee?.amount_refunded??null,
  observed_artist_connect_allocation_cents:actualArtist,
  observed_platform_application_fee_cents:netFee,
  observed_charge_refund_balance_fee_cents:providerFees,
  charge_balance:chargeBalance,refunds,attention
 }
}

/** Independent order-based 90/10 expectation for ordinary artwork only.
 * Refund rounding is a review expectation, not evidence of returned money.
 * Shipping, tax, discounts and mixed-currency cases need separate allocation policy.
 */
export function compareGalleryOrderSettlement(
 order:{subtotal_cents:number,total_cents:number,shipping_cents:number,tax_cents:number,currency:string},
 snapshot:Awaited<ReturnType<typeof observeGallerySettlement>>
){
 const {subtotal_cents:subtotal,total_cents:total,shipping_cents:shipping,tax_cents:tax}=order
 if(snapshot.currency!==order.currency||![subtotal,total,shipping,tax].every(Number.isSafeInteger)||
   subtotal<=0||total<=0||shipping<0||tax<0||snapshot.captured_cents!==total)
  throw Error('Order settlement basis mismatch')
 const house=snapshot.sale_kind==='house'
 const originalFee=house?0:Math.floor(subtotal/10)
 const attention=[...snapshot.attention]
 if((snapshot.expected_original_fee_cents??(house?0:null))!==originalFee||
   (snapshot.application_fee_cents!==null&&snapshot.application_fee_cents!==originalFee))
  attention.push('order_commission_mismatch')
 const ordinary=shipping===0&&tax===0&&subtotal===total
 if(!ordinary)attention.push('non_artwork_amount_review')
 const refunded=snapshot.refunded_cents
 if(!Number.isSafeInteger(refunded)||refunded<0||refunded>total)throw Error('Order refund amount mismatch')
 const final=ordinary&&!attention.includes('refund_not_final')
 const expectedFee=final?originalFee-Math.floor(originalFee*refunded/subtotal):null
 const expectedArtist=expectedFee===null?null:house?0:subtotal-refunded-expectedFee
 if(expectedFee!==null&&snapshot.observed_platform_application_fee_cents!==null&&
    snapshot.observed_platform_application_fee_cents!==expectedFee)attention.push('order_net_commission_mismatch')
 if(expectedArtist!==null&&snapshot.observed_artist_connect_allocation_cents!==null&&
    snapshot.observed_artist_connect_allocation_cents!==expectedArtist)attention.push('order_net_artist_mismatch')
 return {sale_kind:snapshot.sale_kind,order_subtotal_cents:subtotal,order_total_cents:total,
  expected_original_commission_cents:originalFee,
  expected_remaining_commission_cents:expectedFee,expected_remaining_artist_cents:expectedArtist,
  observed_platform_after_charge_refund_fees_cents:
   snapshot.observed_charge_refund_balance_fee_cents!==null
    ?house?(attention.includes('refund_not_final')?null:total-refunded-snapshot.observed_charge_refund_balance_fee_cents)
     :snapshot.observed_platform_application_fee_cents!==null
      ?snapshot.observed_platform_application_fee_cents-snapshot.observed_charge_refund_balance_fee_cents:null
    :null,
  attention:[...new Set(attention)]}
}
