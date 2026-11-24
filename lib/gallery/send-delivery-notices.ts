import {createAdminClient} from '@/lib/supabase/admin'
import {sendEmail} from '@/lib/email/send'
export async function sendGalleryDeliveryNotices(){
 if(process.env.GALLERY_DELIVERY_NOTICES!=='true')return {enabled:false,sent:0,attention:0}
 const db=createAdminClient()
 const {data:rows,error}=await db.from('gallery_delivery_outbox').select('order_id,attempts').eq('state','pending').lte('next_attempt_at',new Date().toISOString()).limit(20)
 if(error)throw Error('Notification queue unavailable')
 let sent=0,attention=0
 for(const row of rows||[]){
  const {data:claim,error:claimError}=await db.from('gallery_delivery_outbox').update({state:'sending',attempts:row.attempts+1,lease_until:new Date(Date.now()+300000).toISOString()}).eq('order_id',row.order_id).eq('state','pending').eq('attempts',row.attempts).select('order_id').maybeSingle()
  if(claimError||!claim)continue
  const finish=async(state:string,code:string|null=null)=>{
   const {error}=await db.from('gallery_delivery_outbox').update({state,last_error_code:code,lease_until:null,...(state==='sent'?{sent_at:new Date().toISOString()}:{})}).eq('order_id',row.order_id).eq('state','sending')
   if(error)throw Error('Notification result persistence failed')
  }
  const {data:order,error:orderError}=await db.from('orders').select('user_id,paid_at,fulfillment_state').eq('id',row.order_id).maybeSingle()
  if(orderError||!order){await finish('attention','order_lookup');attention++;continue}
  if(!order.paid_at||order.fulfillment_state!=='delivered'){await finish('canceled');continue}
  const {data:identity,error:identityError}=await db.auth.admin.getUserById(order.user_id)
  const email=identity?.user?.email
  if(identityError||!email||!identity.user.email_confirmed_at){await finish('attention','recipient_unverified');attention++;continue}
  const result=await sendEmail({to:email,subject:'Your Café Sativa artwork is ready',html:'<p>Your artwork is ready. Sign in to <a href="https://www.cafe-sativa.com/account/artwork">My Artwork</a> to access your purchase.</p>',text:'Your artwork is ready. Sign in at https://www.cafe-sativa.com/account/artwork to access your purchase.'})
  if(result.ok&&result.id){await finish('sent');sent++}
  else {await finish('attention','send_unconfirmed');attention++}
 }
 // Expired sending claims are deliberately not retried automatically.
 const {error:leaseError}=await db.from('gallery_delivery_outbox').update({state:'attention',last_error_code:'expired_send_claim',lease_until:null}).eq('state','sending').lt('lease_until',new Date().toISOString())
 if(leaseError)throw Error('Notification lease reconciliation failed')
 return {enabled:true,sent,attention}
}
