import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isContentAdmin } from '@/lib/content/auth'
import { approvedAsset, CONTENT_POLICY, WEEKLY_SLOTS } from '@/lib/content/policy'
import { planApprovedClipFeatures } from '@/lib/content/clip-features'

export const dynamic = 'force-dynamic'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const checks = ['geometry', 'furniture', 'lighting', 'noPeople', 'noInventedText', 'captionAccuracy'] as const
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET() {
  if (!await isContentAdmin()) return response({ error: 'Sign in with an authorized content administrator account.' }, 401)
  try {
    const db = createAdminClient()
    const [jobs, assets, budget, social] = await Promise.all([
      db.from('cs_content_jobs').select('*').order('created_at', { ascending: false }).limit(50),
      db.from('cs_canonical_assets').select('*').order('subject').limit(100),
      db.from('cs_content_budget').select('*').order('month', { ascending: false }).limit(12),
      db.from('cs_social_connections').select('status,dispatch_enabled,capabilities_verified').eq('provider','metricool').maybeSingle(),
    ])
    if (jobs.error || assets.error || budget.error || social.error) throw new Error('Unavailable')
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
      characterMediaReady: (assets.data || []).some(asset => asset.kind === 'character' && approvedAsset(asset)),
      socialDispatchConfigured: Boolean(social.data?.status==='verified' && social.data.dispatch_enabled && social.data.capabilities_verified),
      voiceVerification: 'Owner reported all three Ask voices working on October 9, 2026. Visual identity approval is separate.',
    }
    return response({ operational, jobs: previews, assets: assets.data, budget: budget.data, generationEnabled: process.env.CS_CONTENT_GENERATION_ENABLED === 'true', monthlyLimitCents: CONTENT_POLICY.monthlyBudgetCents })
  } catch { return response({ error: 'Review data unavailable.' }, 503) }
}

export async function POST(req: NextRequest) {
  if (!await isContentAdmin()) return response({ error: 'Unauthorized' }, 401)
  if (req.headers.get('origin') !== req.nextUrl.origin) return response({ error: 'Invalid origin' }, 403)
  if (Number(req.headers.get('content-length')) > 4096) return response({ error: 'Request too large' }, 413)
  try {
    const body = await req.json()
    if (!uuid.test(body.id || '') || !['approve', 'reject'].includes(body.action)) return response({ error: 'Invalid review' }, 400)
    if (body.action === 'approve' && !checks.every(key => body.checks?.[key] === true)) return response({ error: 'Complete every accuracy check before approval.' }, 400)
    const { data: { user } } = await createClient().auth.getUser()
    if (!user || user.app_metadata?.cafe_sativa_admin !== true) return response({ error: 'Unauthorized' }, 401)
    const db = createAdminClient()
    const found = await db.from('cs_content_jobs').select('*').eq('id', body.id).maybeSingle()
    if (found.error) throw found.error
    const job = found.data
    if (!job || job.status !== 'pending_qa') return response({ error: 'This job is no longer awaiting review.' }, 409)
    if (body.action === 'approve') {
      if (!/^[0-9a-f-]{36}\.mp4$/i.test(job.output_url || '') || job.policy_version !== CONTENT_POLICY.version) return response({ error: 'Current policy and stored video required.' }, 409)
      const asset = await db.from('cs_canonical_assets').select('id').eq('id', job.canonical_asset_id).eq('active', true).eq('kind', 'venue').eq('subject', job.room).not('approved_by', 'is', null).not('approved_at', 'is', null).maybeSingle()
      if (asset.error) throw asset.error
      if (!asset.data) return response({ error: 'The venue reference is no longer approved.' }, 409)
      const media = await db.storage.from('cafe-sativa-content').createSignedUrl(job.output_url, 60)
      if (media.error || !media.data) return response({ error: 'Stored video unavailable.' }, 409)
    }
    const changed = await db.from('cs_content_jobs').update({
      status: body.action === 'approve' ? 'approved' : 'failed',
      qa_approved_by: body.action === 'approve' ? user.id : null,
      qa_approved_at: body.action === 'approve' ? new Date().toISOString() : null,
      blocker: body.action === 'approve' ? null : 'Rejected in accuracy review; no automatic paid retry',
      updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('status', 'pending_qa').select('id,status').maybeSingle()
    if (changed.error) throw changed.error
    if(!changed.data)return response({ error: 'Another review changed this job. Refresh.' }, 409)
    if(body.action==='approve') {
      try { return response({...changed.data,websiteDraftsPrepared:await planApprovedClipFeatures()}) }
      catch { return response({...changed.data,websiteDraftWarning:'Clip approval saved. Use Prepare approved clip drafts in Website programming to retry website-card preparation.'}) }
    }
    return response(changed.data)
  } catch { return response({ error: 'Review could not be saved.' }, 503) }
}
