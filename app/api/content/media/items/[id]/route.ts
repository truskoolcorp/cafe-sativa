import { reviewedVenueBytes, venueByteRange, venueByteStream, acquireVenueResponse } from '@/lib/content/venue-watermark'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canDownloadContentMedia } from '@/lib/content/media-access'
import { approvedMediaJob, MEDIA_UUID } from '@/lib/content/approved-media'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest,{params}:{params:{id:string}}) {
  const unavailable=(message:string,status=404)=>new NextResponse(message,{status,headers:{'Cache-Control':'private, no-store'}})
  if(!MEDIA_UUID.test(params.id))return unavailable('Unavailable')
  const download=req.nextUrl.searchParams.get('download')==='1'
  if(download && !await canDownloadContentMedia())return unavailable('Downloads require an administrator or manager account',403)
  const releasePermit=acquireVenueResponse()
  if(!releasePermit)return new NextResponse('Busy',{status:503,headers:{'Cache-Control':'private, no-store'}})
  let handedToStream=false
  let stage='release_lookup'
  try {
    const db=createAdminClient()
    const result=await db.from('content_items').select('*').eq('id',params.id).in('status',['approved','scheduled','published']).maybeSingle()
    if(result.error)throw result.error
    const item=result.data
    const release=item?.scheduled_at && new Date(item.scheduled_at).getTime()
    if(!item?.approved_by || !item.approved_at || !item.copy_final?.trim() || !release || !Number.isFinite(release) || release>Date.now())return unavailable('Not released yet')
    stage='canonical_approval'
    const job=await approvedMediaJob(item,false)
    if(!job)return unavailable('Unavailable')
    const range=req.headers.get('range')
    if(range && !/^bytes=(\d+-\d*|-\d+)$/.test(range))return unavailable('Invalid range',416)
    stage='watermark_review'
    const verified=await reviewedVenueBytes(db,job)
    const selected=venueByteRange(verified.bytes,req.headers.get('range'))
    if(!selected)return new NextResponse('Invalid range',{status:416,headers:{'Cache-Control':'private, no-store'}})
    const headers=new Headers({'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Disposition':`${download?'attachment':'inline'}; filename="cafe-sativa-${params.id}.mp4"`})
    for(const [key,value] of Object.entries(selected.headers))if(value)headers.set(key,value)
    handedToStream=true
    return new NextResponse(venueByteStream(selected.body,releasePermit),{status:selected.status,headers})
  }catch{console.error('[content-media]',{stage,outcome:'exception'});return unavailable('Unavailable',503)} finally {if(!handedToStream)releasePermit()}
}
