import Stripe from 'stripe'
import {createAdminClient} from '@/lib/supabase/admin'
import {galleryEnvironment} from '@/lib/gallery/environment'
import {observeGallerySettlement,compareGalleryOrderSettlement} from '@/lib/gallery/observe-stripe-settlement'

/** Explicit isolated-test helper; deliberately not exposed as a route or cron.
 * Production enablement requires separate review. Does not create provider transactions.
 */
export async function persistGalleryTestSettlement(requestUrl:string,orderId:string){
 if(galleryEnvironment(requestUrl)!=='isolated-test'||process.env.GALLERY_SETTLEMENT_OBSERVATIONS!=='true')
  throw Error('Settlement test observation disabled')
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY!)
 const db=createAdminClient()
 const {data:order,error}=await db.from('orders').select('id,currency,stripe_payment_intent_id,paid_at,subtotal_cents,total_cents,shipping_cents,tax_cents').eq('id',orderId).maybeSingle()
 if(error||!order?.paid_at||!order.stripe_payment_intent_id)throw Error('Paid test order unavailable')
 const snapshot=await observeGallerySettlement(stripe,order.stripe_payment_intent_id,false)
 if(snapshot.currency!==order.currency)throw Error('Order currency mismatch')
 const comparison=compareGalleryOrderSettlement(order,snapshot)
 const evidence={...snapshot,order_comparison:comparison}
 const {error:writeError}=await db.from('gallery_settlement_observations').insert({
  order_id:order.id,stripe_payment_intent_id:order.stripe_payment_intent_id,provider_snapshot:evidence
 })
 if(writeError)throw Error('Settlement observation persistence failed')
 return evidence
}
