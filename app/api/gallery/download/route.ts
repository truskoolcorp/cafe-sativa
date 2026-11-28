import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { galleryEnvironment } from '@/lib/gallery/environment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = {'Cache-Control':'private, no-store'}
const deny = (status=404) => NextResponse.json({error:'Download unavailable'},{status,headers})

export async function GET(req: Request) {
  if(process.env.GALLERY_PRIVATE_DOWNLOADS !== 'true' || galleryEnvironment(req.url)==='blocked') return deny(503)
  const orderId = new URL(req.url).searchParams.get('order')
  if(!orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return deny()
  const jar = cookies()
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{get:(name:string)=>jar.get(name)?.value,set:()=>{},remove:()=>{}}})
  const {data:{user},error:authError} = await client.auth.getUser()
  if(authError || !user) return deny(401)
  const admin = createAdminClient()
  const {data:order,error} = await admin.from('orders').select('id,user_id,paid_at,fulfillment_state,order_items(product_id,products(kind))').eq('id',orderId).eq('user_id',user.id).maybeSingle()
  if(error || !order || !order.paid_at || order.fulfillment_state !== 'delivered') return deny()
  const items = order.order_items as unknown as Array<{product_id:string;products:{kind:string}|null}>
  if(!Array.isArray(items) || items.length!==1 || items[0].products?.kind!=='digital') return deny()
  const {data:asset,error:assetError} = await admin.from('gallery_private_deliveries').select('object_path,approved_asset_id').eq('order_id',orderId).eq('product_id',items[0].product_id).maybeSingle()
  if(assetError || !asset?.approved_asset_id || typeof asset.object_path!=='string' || !asset.object_path.startsWith(orderId+'/') || asset.object_path.includes('..')) return deny()
  const {data:approved,error:approvalError} = await admin.from('gallery_approved_assets').select('id,revoked_at,sha256').eq('id',asset.approved_asset_id).eq('product_id',items[0].product_id).maybeSingle()
  if(approvalError || !approved || approved.revoked_at || !/^[a-f0-9]{64}$/.test(approved.sha256)) return deny()
  const privateDestination=async()=>{
    try{
      const bucket=await admin.storage.getBucket('gallery-private')
      return !bucket.error&&bucket.data?.id==='gallery-private'&&bucket.data.public===false
    }catch{return false}
  }
  if(!await privateDestination())return deny(503)
  // No transferable storage bearer link: every request must be authenticated.
  // Verify the actual bytes before starting any response, not just the staged row.
  let bytes:Uint8Array
  try {
    const object=await admin.storage.from('gallery-private').download(asset.object_path)
    if(object.error||!object.data||object.data.size<1||object.data.size>50*1024*1024)return deny(503)
    bytes=new Uint8Array(await object.data.arrayBuffer())
    if(bytes.length!==object.data.size||createHash('sha256').update(bytes).digest('hex')!==approved.sha256)return deny(503)
  }catch{return deny(503)}
  // Recheck the entitlement, exact mapping and edition after the private read.
  const [current,edition,mapping]=await Promise.all([
    admin.from('orders').select('id').eq('id',orderId).eq('user_id',user.id).eq('fulfillment_state','delivered').not('paid_at','is',null).maybeSingle(),
    admin.from('gallery_approved_assets').select('id').eq('id',asset.approved_asset_id).eq('product_id',items[0].product_id).eq('sha256',approved.sha256).is('revoked_at',null).maybeSingle(),
    admin.from('gallery_private_deliveries').select('order_id').eq('order_id',orderId).eq('product_id',items[0].product_id).eq('approved_asset_id',asset.approved_asset_id).eq('object_path',asset.object_path).maybeSingle(),
  ])
  if(current.error || !current.data || edition.error || !edition.data || mapping.error || !mapping.data)return deny()
  if(!await privateDestination())return deny(503)
  const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)
  // Stream verified bytes without exposing a storage URL. A refund cannot recall
  // bytes already received or stop a response whose authorization already passed.
  let offset=0
  const stream=new ReadableStream<Uint8Array>({pull(controller){
    if(offset>=bytes.length){controller.close();return}
    const end=Math.min(offset+64*1024,bytes.length)
    controller.enqueue(bytes.subarray(offset,end));offset=end
  }})
  return new Response(stream,{headers:{...headers,
    'Content-Type':'application/octet-stream',
    'Content-Disposition':'attachment; filename="cafe-sativa-artwork.'+(png?'png':'bin')+'"',
    'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin',
  }})
}
