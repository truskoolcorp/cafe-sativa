import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canDownloadContentMedia } from '@/lib/content/media-access'
import { CONTENT_POLICY } from '@/lib/content/policy'
export const dynamic = 'force-dynamic'
// Only this owner-approved pilot is released for the authorized social delivery.
const PILOT = 'ee51c8a4-cffa-4dc1-b34d-cc5b98dc43eb'
export async function GET(req:NextRequest) {
  const download=req.nextUrl.searchParams.get('download')==='1'
  if(download && !await canDownloadContentMedia())return new NextResponse('Downloads require an administrator or manager account',{status:403,headers:{'Cache-Control':'private, no-store'}})
  try {
    const db = createAdminClient()
    const {data: job,error} = await db.from('cs_content_jobs').select('*').eq('id',PILOT).maybeSingle()
    if (error || !job || !['approved','scheduled','published'].includes(job.status) || !job.qa_approved_by || !job.qa_approved_at || job.policy_version !== CONTENT_POLICY.version || job.output_url !== PILOT+'.mp4') return new NextResponse('Unavailable',{status:404})
    const {data:asset,error:assetError} = await db.from('cs_canonical_assets').select('id').eq('id',job.canonical_asset_id).eq('active',true).eq('kind','venue').eq('subject',job.room).not('approved_at','is',null).not('approved_by','is',null).maybeSingle()
    if (assetError || !asset) return new NextResponse('Unavailable',{status:404})
    const signed = await db.storage.from('cafe-sativa-content').createSignedUrl(job.output_url,300)
    if (signed.error || !signed.data) return new NextResponse('Unavailable',{status:503})
    // Keep the storage URL server-side. Public playback is streamed inline.
    const range=req.headers.get('range')
    if(range && !/^bytes=(\d+-\d*|-\d+)$/.test(range))return new NextResponse('Invalid range',{status:416})
    const media=await fetch(signed.data.signedUrl,{headers:range?{Range:range}:{},cache:'no-store',signal:AbortSignal.timeout(15000)})
    if(!media.ok)return new NextResponse('Unavailable',{status:media.status===416?416:503})
    const headers=new Headers({'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Disposition':`${download?'attachment':'inline'}; filename="cafe-sativa-approved-bar.mp4"`})
    for(const key of ['content-length','content-range']){const value=media.headers.get(key);if(value)headers.set(key,value)}
    return new NextResponse(media.body,{status:media.status,headers})
  } catch { return new NextResponse('Unavailable',{status:503}) }
}

