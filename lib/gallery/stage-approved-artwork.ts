import {createHash} from 'node:crypto'
import {createAdminClient} from '@/lib/supabase/admin'

/** Requires a trusted order-to-edition mapping established at purchase.
 * Never chooses the latest edition or downloads arbitrary external URLs.
 */
export async function stageApprovedArtwork(orderId:string) {
 if(process.env.GALLERY_DIGITAL_WORKER!=='true')return false
 const db=createAdminClient()
 const {data:delivery,error}=await db.from('gallery_private_deliveries').select('order_id,product_id,object_path,approved_asset_id').eq('order_id',orderId).maybeSingle()
 if(error||!delivery?.approved_asset_id)return false
 const {data:order,error:orderError}=await db.from('orders').select('paid_at,fulfillment_state').eq('id',orderId).maybeSingle()
 if(orderError||!order?.paid_at||order.fulfillment_state!=='pending')return false
 const {data:asset,error:assetError}=await db.from('gallery_approved_assets').select('object_path,sha256,product_id,revoked_at').eq('id',delivery.approved_asset_id).maybeSingle()
 if(assetError||!asset||asset.revoked_at||asset.product_id!==delivery.product_id)return false
 if(!delivery.object_path.startsWith(orderId+'/')||delivery.object_path.includes('..')||!asset.object_path.startsWith(asset.product_id+'/')||asset.object_path.includes('..'))return false
 // The pre-checkout gate is not an enduring storage attestation. Never copy
 // the master when either bucket is missing or has become public.
 const privateBuckets=async()=>{
  const [a,d]=await Promise.all([db.storage.getBucket('gallery-approved'),db.storage.getBucket('gallery-private')])
  return !a.error&&!d.error&&a.data?.id==='gallery-approved'&&a.data.public===false&&
   d.data?.id==='gallery-private'&&d.data.public===false
 }
 if(!await privateBuckets())return false
 const source=await db.storage.from('gallery-approved').download(asset.object_path)
 if(source.error||!source.data||source.data.size<1||source.data.size>50*1024*1024)return false
 const bytes=Buffer.from(await source.data.arrayBuffer())
 if(bytes.length!==source.data.size||createHash('sha256').update(bytes).digest('hex')!==asset.sha256||!await privateBuckets())return false
 const bucket=db.storage.from('gallery-private')
 // Whether upload succeeds or the immutable object already exists, authorize
 // only after actual readback of identical bytes from the private destination.
 await bucket.upload(delivery.object_path,bytes,{upsert:false,contentType:'application/octet-stream'})
 const existing=await bucket.download(delivery.object_path)
 if(existing.error||!existing.data||existing.data.size!==bytes.length)return false
 const stored=Buffer.from(await existing.data.arrayBuffer())
 return stored.length===bytes.length&&createHash('sha256').update(stored).digest('hex')===asset.sha256&&await privateBuckets()
}
