import Stripe from 'stripe'
import {createAdminClient} from '@/lib/supabase/admin'
export async function recordGalleryRefunds(stripe:Stripe,charge:Stripe.Charge){
 if(process.env.GALLERY_REFUND_LEDGER!=='true')return
 const pi=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id
 if(!pi)return
 const db=createAdminClient()
 const {data:order,error}=await db.from('orders').select('id,currency').eq('stripe_payment_intent_id',pi).maybeSingle()
 if(error)throw Error('Refund order lookup failed')
 if(!order)return
 for await(const refund of stripe.refunds.list({charge:charge.id,limit:100})){
  if(refund.currency!==order.currency||refund.amount<=0)throw Error('Refund currency or amount mismatch')
  const {error:writeError}=await db.from('gallery_refund_receipts').upsert({
   stripe_refund_id:refund.id,order_id:order.id,stripe_payment_intent_id:pi,
   amount_cents:refund.amount,currency:refund.currency,provider_status:refund.status||'unknown',
   reconciliation_state:'attention',observed_at:new Date().toISOString()
  },{onConflict:'stripe_refund_id'})
  if(writeError)throw Error('Refund receipt write failed')
 }
}
