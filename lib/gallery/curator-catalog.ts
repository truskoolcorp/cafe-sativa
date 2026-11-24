import { createClient } from '@supabase/supabase-js'

// Public catalog only; never use the service-role client for curator grounding.
export async function loadCuratorCatalog() {
  try {
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL
    const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if(!url || !key) return {status:'unavailable' as const,works:[]}
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data,error}=await client.from('gallery_v')
      .select('slug,title,description,kind,price_cents,currency,stock_count,artist_name')
      .order('created_at',{ascending:false}).limit(60)
    if(error) return {status:'unavailable' as const,works:[]}
    return {status:'available' as const,works:(data||[]).map(row=>({
      title:row.title,artist:row.artist_name,description:typeof row.description==='string'?row.description.slice(0,1200):null,
      kind:row.kind==='nft'?'digital collectible; on-chain delivery not verified':row.kind,
      priceCents:row.price_cents,currency:row.currency,
      availability:row.stock_count===null?'confirm availability':row.stock_count>0?'listed in stock':'sold out',
      path:'/gallery/'+encodeURIComponent(row.slug)
    }))}
  } catch {return {status:'unavailable' as const,works:[]}}
}
