import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
const headers = {'Cache-Control':'private, no-store'}
const deny = (status=404) => NextResponse.json({error:'Download unavailable'},{status,headers})

export async function GET(req: Request) {
  if(process.env.GALLERY_PRIVATE_DOWNLOADS !== 'true') return deny(503)
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
  const {data:asset,error:assetError} = await admin.from('gallery_private_deliveries').select('object_path').eq('order_id',orderId).eq('product_id',items[0].product_id).maybeSingle()
  if(assetError || !asset || typeof asset.object_path!=='string' || !asset.object_path.startsWith(orderId+'/') || asset.object_path.includes('..')) return deny()
  const {data:signed,error:signError} = await admin.storage.from('gallery-private').createSignedUrl(asset.object_path,60,{download:true})
  if(signError || !signed?.signedUrl) return deny(503)
  return NextResponse.json({url:signed.signedUrl,expires_in:60},{headers})
}
