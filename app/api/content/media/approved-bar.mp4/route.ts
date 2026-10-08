import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CONTENT_POLICY } from '@/lib/content/policy'
export const dynamic = 'force-dynamic'
// Only this owner-approved pilot is released for the authorized social delivery.
const PILOT = 'ee51c8a4-cffa-4dc1-b34d-cc5b98dc43eb'
export async function GET() {
  try {
    const db = createAdminClient()
    const {data: job,error} = await db.from('cs_content_jobs').select('*').eq('id',PILOT).maybeSingle()
    if (error || !job || !['approved','scheduled','published'].includes(job.status) || !job.qa_approved_by || !job.qa_approved_at || job.policy_version !== CONTENT_POLICY.version || job.output_url !== PILOT+'.mp4') return new NextResponse('Unavailable',{status:404})
    const {data:asset,error:assetError} = await db.from('cs_canonical_assets').select('id').eq('id',job.canonical_asset_id).eq('active',true).eq('kind','venue').eq('subject',job.room).not('approved_at','is',null).not('approved_by','is',null).maybeSingle()
    if (assetError || !asset) return new NextResponse('Unavailable',{status:404})
    const signed = await db.storage.from('cafe-sativa-content').createSignedUrl(job.output_url,300)
    if (signed.error || !signed.data) return new NextResponse('Unavailable',{status:503})
    return NextResponse.redirect(signed.data.signedUrl,{status:307,headers:{'Cache-Control':'no-store'}})
  } catch { return new NextResponse('Unavailable',{status:503}) }
}
