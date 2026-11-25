import Link from 'next/link'
import {redirect} from 'next/navigation'
import {cookies} from 'next/headers'
import {createServerClient} from '@supabase/ssr'
import DownloadArtwork from '@/app/gallery/thanks/DownloadArtwork'
export const dynamic='force-dynamic'
export default async function ArtworkLibrary(){
 const jar=cookies()
 const db=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{cookies:{get:(name:string)=>jar.get(name)?.value,set:()=>{},remove:()=>{}}})
 const {data:{user}}=await db.auth.getUser()
 if(!user)redirect('/auth/signin?redirect=/account/artwork')
 const {data,error}=await db.from('orders').select('id,paid_at,fulfillment_state,order_items(title_snapshot,products(kind))').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100)
 return <main className="max-w-4xl mx-auto px-6 pt-24 pb-16"><Link href="/account" className="underline">Back to account</Link><h1 className="font-heading text-4xl my-6">My artwork</h1>{error?<p role="alert">Orders are temporarily unavailable.</p>:!data?.length?<p>No artwork orders yet. <Link href="/gallery" className="underline">Explore the Gallery</Link></p>:data.map(order=>{
 const items=order.order_items as unknown as Array<{title_snapshot:string;products:{kind:string}|null}>
 const item=items?.[0]
 const eligible=Boolean(order.paid_at)&&order.fulfillment_state==='delivered'&&items?.length===1&&item?.products?.kind==='digital'&&process.env.GALLERY_PRIVATE_DOWNLOADS==='true'
 return <article key={order.id} className="border border-border rounded-xl p-5 mb-4"><h2 className="font-heading text-xl">{item?.title_snapshot||'Artwork order'}</h2><p className="text-sm my-3">Order #{order.id.slice(0,8)} · {order.paid_at?order.fulfillment_state:'Payment pending'}</p>{eligible&&<DownloadArtwork orderId={order.id}/>}</article>
 })}</main>
}
