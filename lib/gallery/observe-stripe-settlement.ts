import Stripe from 'stripe'

/** Read-only provider observations. Amounts are minor currency units.
 * Aggregate reversals are not attributed to individual refunds.
 * Missing provider objects remain unknown, never inferred from 90/10.
 */
export async function observeGallerySettlement(stripe:Stripe,paymentIntentId:string){
 const intent=await stripe.paymentIntents.retrieve(paymentIntentId,{expand:['latest_charge']})
 const charge=intent.latest_charge
 if(!charge||typeof charge==='string'||intent.metadata?.kind!=='gallery_order')throw Error('Gallery charge unavailable')
 const transferId=typeof charge.transfer==='string'?charge.transfer:charge.transfer?.id
 const feeId=typeof charge.application_fee==='string'?charge.application_fee:charge.application_fee?.id
 const [transfer,fee]=await Promise.all([
  transferId?stripe.transfers.retrieve(transferId):Promise.resolve(null),
  feeId?stripe.applicationFees.retrieve(feeId):Promise.resolve(null)
 ])
 if(transfer&&transfer.currency!==charge.currency)throw Error('Transfer currency mismatch')
 if(fee&&fee.currency!==charge.currency)throw Error('Fee currency mismatch')
 return {
  payment_intent_id:intent.id,charge_id:charge.id,currency:charge.currency,
  captured_cents:charge.amount_captured,refunded_cents:charge.amount_refunded,
  transfer_id:transfer?.id??null,transfer_cents:transfer?.amount??null,
  transfer_reversed_cents:transfer?.amount_reversed??null,
  application_fee_id:fee?.id??null,application_fee_cents:fee?.amount??null,
  application_fee_refunded_cents:fee?.amount_refunded??null,
  observed_at:new Date().toISOString()
 }
}
