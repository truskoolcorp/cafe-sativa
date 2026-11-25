import Stripe from 'stripe'
import {createAdminClient} from '@/lib/supabase/admin'
export async function reconcileGalleryInventory(){
 if(process.env.GALLERY_INVENTORY_HOLDS!=='true')return {enabled:false,released:0,attention:0}
 const key=process.env.STRIPE_SECRET_KEY
 if(!key)throw Error('Stripe unavailable')
 const stripe=new Stripe(key)
 const db=createAdminClient()
 const {data:holds,error}=await db.from('gallery_inventory_holds').select('id,product_id,user_id,quantity,stripe_session_id').eq('state','held').lte('expires_at',new Date().toISOString()).limit(20)
 if(error)throw Error('Inventory queue unavailable')
 let released=0,attention=0
 for(const hold of holds||[]){
  let safe=false
  if(hold.stripe_session_id){
   try{
    const s=await stripe.checkout.sessions.retrieve(hold.stripe_session_id,{expand:['payment_intent']})
    const pi=s.payment_intent
    safe=s.metadata?.site==='cafe-sativa'&&s.metadata?.inventory_hold_id===hold.id&&s.metadata?.product_id===hold.product_id&&s.metadata?.user_id===hold.user_id&&s.metadata?.quantity===String(hold.quantity)&&s.status==='expired'&&s.payment_status==='unpaid'&&(!pi||(typeof pi!=='string'&&pi.status==='canceled'))
   }catch{/* Preserve inventory when provider state is uncertain. */}
  }
  const {data:updated,error:updateError}=await db.from('gallery_inventory_holds').update({state:safe?'released':'attention'}).eq('id',hold.id).eq('state','held').select('id').maybeSingle()
  if(updateError)throw Error('Inventory reconciliation write failed')
  if(updated){if(safe)released++;else attention++}
 }
 return {enabled:true,released,attention}
}
