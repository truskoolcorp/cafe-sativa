import {createAdminClient} from '@/lib/supabase/admin'

/** Authorize only orders with a trusted, already staged private delivery.
 * Does not fetch artist URLs, upload unreviewed files, or mint tokens.
 */
export async function authorizeStagedDigitalOrders() {
 if(process.env.GALLERY_DIGITAL_WORKER !== 'true') return {enabled:false,authorized:0,deferred:0}
 const db=createAdminClient()
 const {data,error}=await db.from('gallery_private_deliveries')
 .select('order_id,orders!inner(fulfillment_state,paid_at)')
 .eq('orders.fulfillment_state','pending').not('orders.paid_at','is',null)
 .order('created_at',{ascending:true}).limit(50)
 if(error)throw Error('Gallery fulfillment queue unavailable')
 let authorized=0,deferred=0
 for(const row of data||[]){
  const {data:ok,error:rpcError}=await db.rpc('cs_authorize_gallery_delivery',{p_order:row.order_id})
  if(rpcError||ok!==true){deferred++;continue}
  authorized++
 }
 return {enabled:true,authorized,deferred}
}
