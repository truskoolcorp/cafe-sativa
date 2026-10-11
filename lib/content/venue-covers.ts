import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { approvedAsset } from '@/lib/content/policy'

export const PUBLIC_VENUE_ROOMS = ['stage','kitchen','cigar_lounge','bar','gallery','community','main-lounge','courtyard','cold-stoned-open','cold-stoned-closed'] as const
export function venueCoverMap(assets:any[],origin:string) {
  const covers:Record<string,string>={}
  const seen=new Set<string>()
  for(const asset of assets) {
    if(asset.kind!=='venue' || !PUBLIC_VENUE_ROOMS.includes(asset.subject) || !approvedAsset(asset))continue
    const url=new URL(asset.url),base=new URL(origin)
    if(url.origin!==base.origin || !url.pathname.startsWith('/storage/v1/object/public/cafe-sativa-canon/') || url.search || url.hash)continue
    // An ambiguous active registry must not silently pick one image.
    if(seen.has(asset.subject)){delete covers[asset.subject];continue}
    seen.add(asset.subject);covers[asset.subject]=asset.url
  }
  return Object.fromEntries(Object.entries(covers).filter(([,url])=>url))
}
export const approvedVenueCovers=cache(async()=>{
  try {
    const found=await createAdminClient().from('cs_canonical_assets').select('*').eq('kind','venue').eq('active',true)
    if(found.error)throw found.error
    return venueCoverMap(found.data || [],process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  }catch{return {} as Record<string,string>}
})
