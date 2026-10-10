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
  try {
    const db=createAdminClient()
    const result=await db.from('content_items').select('*').eq('id',params.id).in('status',['approved','scheduled','published']).maybeSingle()
    if(result.error)throw result.error
    const item=result.data
    const release=item?.scheduled_at && new Date(item.scheduled_at).getTime()
    if(!item?.approved_by || !item.approved_at || !item.copy_final?.trim() || !release || !Number.isFinite(release) || release>Date.now())return unavailable('Not released yet')
    const job=await approvedMediaJob(item)
    if(!job)return unavailable('Unavailable')
    const range=req.headers.get('range')
    if(range && !/^bytes=(\d+-\d*|-\d+)$/.test(range))return unavailable('Invalid range',416)
    const signed=await db.storage.from('cafe-sativa-content').createSignedUrl(job.output_url,300)
    if(signed.error || !signed.data)return unavailable('Unavailable',503)
    const media=await fetch(signed.data.signedUrl,{headers:range?{Range:range}:{},cache:'no-store',signal:AbortSignal.timeout(15000)})
    if(!media.ok)return unavailable('Unavailable',media.status===416?416:503)
    const headers=new Headers({'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Disposition':`${download?'attachment':'inline'}; filename="cafe-sativa-${params.id}.mp4"`})
    for(const key of ['content-length','content-range']){const value=media.headers.get(key);if(value)headers.set(key,value)}
    return new NextResponse(media.body,{status:media.status,headers})
  }catch{return unavailable('Unavailable',503)}
}
