import type Stripe from 'stripe'

const idOf = (value: string | {id:string} | null | undefined) =>
 typeof value === 'string' ? value : value?.id ?? null

/** Read-only observation of destination charges, never a bank payout statement.
 * Stripe transfers gross and separately returns the application fee to the platform.
 * Unknown provider records or cross-currency settlements cannot establish a net split.
 */
export async function observeGallerySettlement(stripe:Stripe,paymentIntentId:string,expectedLive:boolean){
 const intent=await stripe.paymentIntents.retrieve(paymentIntentId,{expand:['latest_charge']})
 const charge=intent.latest_charge
 if(intent.id!==paymentIntentId||intent.livemode!==expectedLive||intent.status!=='succeeded'||
   !charge||typeof charge==='string'||charge.livemode!==expectedLive||!charge.paid||
   !charge.captured||idOf(charge.payment_intent)!==intent.id||
   intent.metadata?.kind!=='gallery_order'||charge.currency!==intent.currency)throw Error('Gallery charge unavailable')
 const transferId=idOf(charge.transfer),feeId=idOf(charge.application_fee)
 const destination=idOf(intent.transfer_data?.destination)
 if(!destination)throw Error('Gallery destination unavailable')
 const [transfer,fee]=await Promise.all([
  transferId?stripe.transfers.retrieve(transferId):Promise.resolve(null),
  feeId?stripe.applicationFees.retrieve(feeId):Promise.resolve(null)
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
  const b=await stripe.balanceTransactions.retrieve(id)
  if(b.id!==id||idOf(b.source)!==source||b.currency!==charge.currency||
   b.amount-b.fee!==b.net)throw Error('Balance transaction mismatch')
  return {id:b.id,amount_cents:b.amount,fee_cents:b.fee,net_cents:b.net,status:b.status}
 }
 const chargeBalance=await readBalance(charge.balance_transaction,charge.id)
 if(chargeBalance&&chargeBalance.amount_cents!==charge.amount_captured)throw Error('Captured amount mismatch')
 const refunds=[]
 for await(const refund of stripe.refunds.list({charge:charge.id,limit:100})){
  if(idOf(refund.charge)!==charge.id||refund.currency!==charge.currency||
    !Number.isSafeInteger(refund.amount)||refund.amount<=0)throw Error('Refund mismatch')
  const balance=refund.status==='succeeded'?await readBalance(refund.balance_transaction,refund.id):null
  if(balance&&balance.amount_cents!==-refund.amount)throw Error('Refund balance mismatch')
  refunds.push({id:refund.id,amount_cents:refund.amount,status:refund.status??'unknown',balance})
 }
 const succeeded=refunds.filter(r=>r.status==='succeeded')
 const succeededTotal=succeeded.reduce((n,r)=>n+r.amount_cents,0)
 const netFee=fee?fee.amount-fee.amount_refunded:null
 const netTransfer=transfer?transfer.amount-transfer.amount_reversed:null
 const providerFees=chargeBalance&&succeeded.every(r=>r.balance!==null)&&succeededTotal===charge.amount_refunded
  ?chargeBalance.fee_cents+succeeded.reduce((n,r)=>n+(r.balance?.fee_cents??0),0):null
 const actualArtist=netFee!==null&&netTransfer!==null?netTransfer-netFee:null
 const attention:string[]=[]
 if(!transfer||!fee)attention.push('missing_connect_records')
 if(transfer&&transfer.amount!==charge.amount_captured)attention.push('gross_transfer_mismatch')
 if(fee&&fee.amount!==intent.application_fee_amount)attention.push('application_fee_mismatch')
 if(succeededTotal!==charge.amount_refunded||refunds.some(r=>!['succeeded','failed','canceled'].includes(r.status)))attention.push('refund_not_final')
 if(providerFees===null)attention.push('balance_transactions_incomplete')
 if(transfer&&transfer.amount_reversed!==succeededTotal)attention.push('transfer_reversal_mismatch')
 if(fee&&charge.amount_captured>0&&fee.amount_refunded!==Math.floor(fee.amount*succeededTotal/charge.amount_captured))attention.push('fee_reversal_review')
 return {
  payment_intent_id:intent.id,charge_id:charge.id,currency:charge.currency,livemode:expectedLive,
  captured_cents:charge.amount_captured,refunded_cents:charge.amount_refunded,
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
