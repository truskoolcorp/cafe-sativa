import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { MEDIA_UUID } from '@/lib/content/approved-media'
import { approvedAsset, CONTENT_POLICY } from '@/lib/content/policy'
import { prepareVideoVariant } from '@/lib/content/video-variants'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: {'Cache-Control':'private, no-store'} })

export async function POST(req: NextRequest) {
  if (!await isContentAdmin()) return respond({error:'Unauthorized'},401)
  if(req.headers.get('origin')!==req.nextUrl.origin) return respond({error:'Invalid origin'},403)
  try {
    const body=await req.json()
    if(!MEDIA_UUID.test(body.jobId || '')) return respond({error:'Invalid clip'},400)
    const db=createAdminClient()
    const found=await db.from('cs_content_jobs').select('*').eq('id',body.jobId).maybeSingle()
    if(found.error)throw found.error
    const job=found.data
    const pilot=job?.id==='ee51c8a4-cffa-4dc1-b34d-cc5b98dc43eb' && job.slot_key==='2026-10-07:bar' && job.room==='bar' && job.policy_version==='2026-10-07'
    if(!job || !['approved','scheduled','published'].includes(job.status) || !job.qa_approved_by || !job.qa_approved_at || (!pilot && job.policy_version!==CONTENT_POLICY.version)) return respond({error:'An approved current clip is required'},409)
    const asset=await db.from('cs_canonical_assets').select('*').eq('id',job.canonical_asset_id).eq('kind','venue').eq('subject',job.room).maybeSingle()
    if(asset.error)throw asset.error
    if(!approvedAsset(asset.data))return respond({error:'Current room approval required'},409)
    const variant=await prepareVideoVariant(db,job,'feed')
    return respond({url:variant.url,format:'4:5',width:1080,height:1350,message:'Preview prepared from the approved master. No social post was submitted.'})
  } catch { return respond({error:'Preview export failed. The master and existing schedules are unchanged.'},503) }
}
