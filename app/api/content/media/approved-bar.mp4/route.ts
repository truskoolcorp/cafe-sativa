import { reviewedVenueBytes, venueByteRange, venueByteStream, acquireVenueResponse } from '@/lib/content/venue-watermark'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canDownloadContentMedia } from '@/lib/content/media-access'
export const dynamic = 'force-dynamic'
// Only this owner-approved pilot is released for the authorized social delivery.
const PILOT = 'ee51c8a4-cffa-4dc1-b34d-cc5b98dc43eb'
export async function GET(req:NextRequest) {
  const download=req.nextUrl.searchParams.get('download')==='1'
  if(download && !await canDownloadContentMedia())return new NextResponse('Downloads require an administrator or manager account',{status:403,headers:{'Cache-Control':'private, no-store'}})
  const releasePermit=acquireVenueResponse()
  if(!releasePermit)return new NextResponse('Busy',{status:503,headers:{'Cache-Control':'private, no-store'}})
  let handedToStream=false
  let stage='release_lookup'
  try {
    const db = createAdminClient()
    const release=await db.from('content_items').select('scheduled_at,approved_at,approved_by').eq('site_key','approved-pilot:bar:2026-10-07').in('status',['approved','scheduled','published']).maybeSingle()
    if(release.error || !release.data?.approved_at || !release.data.approved_by || !release.data.scheduled_at || new Date(release.data.scheduled_at).getTime()>Date.now())return new NextResponse('Not released yet',{status:404,headers:{'Cache-Control':'private, no-store'}})
    stage='canonical_approval'
    const {data: job,error} = await db.from('cs_content_jobs').select('*').eq('id',PILOT).maybeSingle()
    if (error || !job || !['approved','scheduled','published'].includes(job.status) || !job.qa_approved_by || !job.qa_approved_at || job.policy_version !== '2026-10-07' || job.output_url !== PILOT+'.mp4') return new NextResponse('Unavailable',{status:404})
    const {data:asset,error:assetError} = await db.from('cs_canonical_assets').select('id').eq('id',job.canonical_asset_id).eq('active',true).eq('kind','venue').eq('subject',job.room).not('approved_at','is',null).not('approved_by','is',null).maybeSingle()
    if (assetError || !asset) return new NextResponse('Unavailable',{status:404})
    stage='watermark_review'
    const verified=await reviewedVenueBytes(db,job)
    const selected=venueByteRange(verified.bytes,req.headers.get('range'))
    if(!selected)return new NextResponse('Invalid range',{status:416,headers:{'Cache-Control':'private, no-store'}})
    const headers=new Headers({'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Disposition':`${download?'attachment':'inline'}; filename="cafe-sativa-approved-bar.mp4"`})
    for(const [key,value] of Object.entries(selected.headers))if(value)headers.set(key,value)
    handedToStream=true
    return new NextResponse(venueByteStream(selected.body,releasePermit),{status:selected.status,headers})
  } catch { console.error('[content-media]',{stage,outcome:'exception'});return new NextResponse('Unavailable',{status:503}) } finally {if(!handedToStream)releasePermit()}
}

