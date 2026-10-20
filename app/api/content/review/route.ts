import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isContentAdmin } from '@/lib/content/auth'
import { approvedAsset, CONTENT_POLICY, WEEKLY_SLOTS,localDate } from '@/lib/content/policy'
import { planApprovedClipFeatures } from '@/lib/content/clip-features'

export const dynamic = 'force-dynamic'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const checks = ['geometry', 'furniture', 'lighting', 'noPeople', 'noInventedText', 'captionAccuracy'] as const
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET() {
  if (!await isContentAdmin()) return response({ error: 'Sign in with an authorized content administrator account.' }, 401)
  try {
    const db = createAdminClient()
    const [jobs, assets, budget, social,website] = await Promise.all([
      db.from('cs_content_jobs').select('*').order('created_at', { ascending: false }).limit(50),
      db.from('cs_canonical_assets').select('*').order('subject').limit(100),
      db.from('cs_content_budget').select('*').order('month', { ascending: false }).limit(12),
      db.from('cs_social_connections').select('status,dispatch_enabled,capabilities_verified,last_error').eq('provider','metricool').maybeSingle(),
      db.from('content_items').select('id,title,site_category,status,copy_draft,scheduled_at,source_job_id').not('site_category','is',null).order('created_at',{ascending:false}).limit(100),
    ])
    if (jobs.error || assets.error || budget.error || social.error || website.error) throw new Error('Unavailable')
    const previews = await Promise.all((jobs.data || []).map(async job => {
      let previewUrl: string | null = null
      if (/^[0-9a-f-]{36}\.mp4$/i.test(job.output_url || '')) {
        const signed = await db.storage.from('cafe-sativa-content').createSignedUrl(job.output_url, 600)
        previewUrl = signed.data?.signedUrl || null
      }
      return { ...job, previewUrl }
    }))
    const approvedRooms = (assets.data || []).filter(asset => asset.kind === 'venue' && approvedAsset(asset)).map(asset => asset.subject)
    const missingRooms = WEEKLY_SLOTS.map(slot => slot.room).filter(room => !approvedRooms.includes(room))
    const operational = {
      missingRooms,
      approvedRoomCount: approvedRooms.length,
      characterSource: 'GLYPH Master References holds the current approved portraits and voices. Character episode production remains unfinished.',
      socialDispatchConfigured: Boolean(social.data?.status==='verified' && social.data.dispatch_enabled && social.data.capabilities_verified && !social.data.last_error),
      voiceVerification: 'Owner reported all three Ask voices working on October 9, 2026. Visual identity approval is separate.',
    }
    return response({ operational, jobs: previews, websiteItems:website.data, assets: assets.data, budget: budget.data, generationEnabled: process.env.CS_CONTENT_GENERATION_ENABLED === 'true', monthlyLimitCents: CONTENT_POLICY.monthlyBudgetCents,monthlyReservedCents:budget.data?.find(row=>row.month===`${localDate(new Date()).slice(0,7)}-01`)?.reserved_cents || 0 })
  } catch { return response({ error: 'Review data unavailable.' }, 503) }
}

export async function POST(req: NextRequest) {
  if (!await isContentAdmin()) return response({ error: 'Unauthorized' }, 401)
  if (req.headers.get('origin') !== req.nextUrl.origin) return response({ error: 'Invalid origin' }, 403)
  if (Number(req.headers.get('content-length')) > 4096) return response({ error: 'Request too large' }, 413)
  try {
    const body = await req.json()
    if (!uuid.test(body.id || '') || !['approve', 'reject', 'override'].includes(body.action)) return response({ error: 'Invalid review' }, 400)
    if (body.action === 'override' && (typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 500)) return response({ error: 'Provide an owner override reason (10–500 characters).' }, 400)
    if (body.action === 'approve' && !checks.every(key => body.checks?.[key] === true)) return response({ error: 'Complete every accuracy check before approval.' }, 400)
    const { data: { user } } = await createClient().auth.getUser()
    if (!user || user.app_metadata?.cafe_sativa_admin !== true) return response({ error: 'Unauthorized' }, 401)
    const db = createAdminClient()
    const found = await db.from('cs_content_jobs').select('*').eq('id', body.id).maybeSingle()
    if (found.error) throw found.error
    const job = found.data
    if (!job || (body.action === 'override' ? !['pending_qa','failed'].includes(job.status) : job.status !== 'pending_qa')) return response({ error: 'This job is no longer eligible for this review.' }, 409)
    if (body.action === 'override' && !job.blocker?.includes('canonical accuracy review') && job.status === 'failed') return response({ error: 'Only visual-QA rejections are eligible for owner override.' }, 409)
    if (body.action === 'approve' || body.action === 'override') {
      if (!/^[0-9a-f-]{36}\.mp4$/i.test(job.output_url || '') || job.policy_version !== CONTENT_POLICY.version) return response({ error: 'Current policy and stored video required.' }, 409)
      const asset = await db.from('cs_canonical_assets').select('*').eq('id', job.canonical_asset_id).eq('active', true).eq('kind', 'venue').eq('subject', job.room).not('approved_by', 'is', null).not('approved_at', 'is', null).maybeSingle()
      if (asset.error) throw asset.error
      if (!approvedAsset(asset.data)) return response({ error: 'The venue reference is no longer approved.' }, 409)
      const snapshot=body.canonicalSnapshot
      if (!snapshot || snapshot.id!==asset.data.id || snapshot.sha256!==asset.data.sha256 || snapshot.version!==asset.data.version) return response({error:'The room reference changed or the review is outdated. Refresh and compare the clip against the current master.'},409)
      const media = await db.storage.from('cafe-sativa-content').createSignedUrl(job.output_url, 60)
      if (media.error || !media.data) return response({ error: 'Stored video unavailable.' }, 409)
    }
    const changed = await db.from('cs_content_jobs').update({
      status: body.action !== 'reject' ? 'approved' : 'failed',
      qa_approved_by: body.action !== 'reject' ? user.id : null,
      qa_approved_at: body.action !== 'reject' ? new Date().toISOString() : null,
      blocker: body.action === 'override' ? `Owner visual override by ${user.id}: ${body.reason.trim()}` : body.action === 'approve' ? null : 'Rejected in accuracy review; no automatic paid retry',
      updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('status', job.status).select('id,status').maybeSingle()
    if (changed.error) throw changed.error
    if(!changed.data)return response({ error: 'Another review changed this job. Refresh.' }, 409)
    if(body.action==='approve' || body.action==='override') {
      try { return response({...changed.data,websiteDraftsPrepared:await planApprovedClipFeatures()}) }
      catch { return response({...changed.data,websiteDraftWarning:'Clip approval saved. Use Prepare approved clip drafts in Website programming to retry website-card preparation.'}) }
    }
    return response(changed.data)
  } catch { return response({ error: 'Review could not be saved.' }, 503) }
}
