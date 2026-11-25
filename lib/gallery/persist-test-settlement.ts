import Stripe from 'stripe'
import {createAdminClient} from '@/lib/supabase/admin'
import {galleryHouseConfig,verifiedGalleryHouseAccount} from '@/lib/gallery/house-checkout'
import {galleryEnvironment} from '@/lib/gallery/environment'
import {observeGallerySettlement,compareGalleryOrderSettlement} from '@/lib/gallery/observe-stripe-settlement'

/** Explicit isolated-test helper; deliberately not exposed as a route or cron. */
export async function persistGalleryTestSettlement(requestUrl:string,orderId:string){
 if(galleryEnvironment(requestUrl)!=='isolated-test'||process.env.GALLERY_SETTLEMENT_OBSERVATIONS!=='true')
  throw Error('Settlement test observation disabled')
 return persistGallerySettlement(orderId,false)
}

/** Draft production entry point, default off and not wired to a route or cron.
 * The account is pinned independently of the seller; no payment or refund writes.
 * Enablement still requires merchant sandbox and production migration review.
 */
export async function persistGalleryProductionSettlement(requestUrl:string,orderId:string){
 if(galleryEnvironment(requestUrl)!=='production'||
    process.env.GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS!=='true'||
    process.env.GALLERY_ISOLATED_TEST==='true'||
    !process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')||
    !/^acct_[A-Za-z0-9]+$/.test(process.env.GALLERY_STRIPE_PLATFORM_ACCOUNT_ID??''))
  throw Error('Production Gallery settlement observation disabled')
 const url=new URL(requestUrl)
 if(url.origin!=='https://www.cafe-sativa.com'||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!=='https://nwfxvhqbjtfvoopcadff.supabase.co')
  throw Error('Production Gallery settlement environment mismatch')
 return persistGallerySettlement(orderId,true)
}

async function persistGallerySettlement(orderId:string,live:boolean){
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY!)
 const db=createAdminClient()
 const {data:order,error}=await db.from('orders').select('id,currency,stripe_payment_intent_id,paid_at,subtotal_cents,total_cents,shipping_cents,tax_cents,user_id').eq('id',orderId).maybeSingle()
 if(error||!order?.paid_at||!order.stripe_payment_intent_id||!order.user_id)throw Error('Paid Gallery order unavailable')
 const {data:items,error:itemError}=await db.from('order_items').select('gallery_sale_kind,product_id,artist_id,quantity,price_cents,line_total_cents,application_fee_cents,transfer_destination').eq('order_id',orderId).limit(2)
 if(itemError||items?.length!==1)throw Error('Single-item settlement basis unavailable')
 const item=items[0]
 if(item.gallery_sale_kind!==null&&item.gallery_sale_kind!=='house')throw Error('Unknown gallery sale classification')
 const saleKind=item.gallery_sale_kind==='house'?'house':'consigned'
 if(!item.product_id||!item.artist_id||![item.quantity,item.price_cents,item.line_total_cents,item.application_fee_cents].every(Number.isSafeInteger)||
    item.quantity<=0||item.price_cents<=0||item.price_cents*item.quantity!==item.line_total_cents||
    item.line_total_cents!==order.subtotal_cents||
    item.application_fee_cents!==(saleKind==='house'?0:Math.floor(item.line_total_cents/10)))
  throw Error('Gallery order line settlement basis mismatch')
 let houseAccountId:string|undefined
 if(saleKind==='house'){
  const house=galleryHouseConfig()
  if(!house||house.productId!==item.product_id||house.artistId!==item.artist_id||item.transfer_destination!==null||
    (live&&house.accountId!==process.env.GALLERY_STRIPE_PLATFORM_ACCOUNT_ID)||
    !await verifiedGalleryHouseAccount(stripe,house.accountId,false))throw Error('House settlement account mismatch')
  houseAccountId=house.accountId
 }else{
  if(!/^acct_[A-Za-z0-9]+$/.test(item.transfer_destination??''))throw Error('Order destination unavailable')
  // A destination identifies the seller, not the platform that owns this payment.
  // Require a separately verified platform binding before reading consigned evidence.
  const platform=live?process.env.GALLERY_STRIPE_PLATFORM_ACCOUNT_ID:process.env.GALLERY_TEST_STRIPE_PLATFORM_ACCOUNT_ID
  if(!platform||!/^acct_[A-Za-z0-9]+$/.test(platform)||platform===item.transfer_destination||
     !await verifiedGalleryHouseAccount(stripe,platform,false))throw Error('Consigned settlement platform mismatch')
 }
 const snapshot=await observeGallerySettlement(stripe,order.stripe_payment_intent_id,live,saleKind,{
  productId:item.product_id,artistId:item.artist_id,buyerId:order.user_id,destination:item.transfer_destination,houseAccountId
 })
 if(snapshot.currency!==order.currency)throw Error('Order currency mismatch')
 const comparison=compareGalleryOrderSettlement(order,snapshot)
 const evidence={...snapshot,order_comparison:comparison}
 const {error:writeError}=await db.from('gallery_settlement_observations').insert({
  order_id:order.id,stripe_payment_intent_id:order.stripe_payment_intent_id,provider_snapshot:evidence
 })
 if(writeError)throw Error('Settlement observation persistence failed')
 return evidence
}
