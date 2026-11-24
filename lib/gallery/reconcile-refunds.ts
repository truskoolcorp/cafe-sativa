import Stripe from 'stripe'
import {createAdminClient} from '@/lib/supabase/admin'
const idOf=(value:string|{id:string}|null|undefined)=>typeof value==='string'?value:value?.id
export async function recordGalleryRefunds(stripe:Stripe,charge:Stripe.Charge){
 if(process.env.GALLERY_REFUND_LEDGER!=='true')return
 const pi=idOf(charge.payment_intent)
 if(!pi)return
 const db=createAdminClient()
 const {data:order,error}=await db.from('orders').select('id,currency,total_cents').eq('stripe_payment_intent_id',pi).maybeSingle()
 if(error)throw Error('Refund order lookup failed')
 if(!order)return
 if(!Number.isSafeInteger(order.total_cents)||order.total_cents<=0||charge.currency!==order.currency||
    charge.amount_captured!==order.total_cents||!Number.isSafeInteger(charge.amount_refunded)||
    charge.amount_refunded<0||charge.amount_refunded>order.total_cents)throw Error('Refund charge basis mismatch')
 // Validate the complete provider response before writing any receipt. A replay
 // may describe an older signed amount; do not overwrite the current provider
 // list with that historical aggregate. Never infer transfer/fee reversals.
 const seen=new Set<string>()
 const rows=[]
 let succeeded=0
 for await(const refund of stripe.refunds.list({charge:charge.id,limit:100})){
  if(!refund.id||seen.has(refund.id)||idOf(refund.charge)!==charge.id||idOf(refund.payment_intent)!==pi||
    refund.currency!==order.currency||!Number.isSafeInteger(refund.amount)||refund.amount<=0||
    refund.amount>order.total_cents)throw Error('Refund identity, currency or amount mismatch')
  seen.add(refund.id)
  if(refund.status==='succeeded')succeeded+=refund.amount
  if(succeeded>order.total_cents)throw Error('Refund total exceeds recorded order')
  rows.push({
   stripe_refund_id:refund.id,order_id:order.id,stripe_payment_intent_id:pi,
   amount_cents:refund.amount,currency:refund.currency,provider_status:refund.status||'unknown',
   reconciliation_state:'attention',observed_at:new Date().toISOString()
  })
 }
 if(rows.length){
  const {error:writeError}=await db.from('gallery_refund_receipts').upsert(rows,{onConflict:'stripe_refund_id'})
  if(writeError)throw Error('Refund receipt write failed')
 }
}
