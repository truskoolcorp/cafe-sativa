import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronAuthorized } from '@/lib/content/auth'
import { approvedAsset, CONTENT_POLICY, dueSlots, localDate } from '@/lib/content/policy'

import { planSiteContent, publishDueSiteContent } from '@/lib/content/site'
import { planApprovedClipFeatures } from '@/lib/content/clip-features'
import { processSocialDelivery } from '@/lib/content/social-delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  try {
    const sitePlanned = await planSiteContent(now)
    const clipFeaturesPlanned = await planApprovedClipFeatures(now)
    const sitePublished = await publishDueSiteContent(now)
    const db = createAdminClient()
    const references = await db.from('cs_canonical_assets').select('*').eq('kind','venue').eq('active',true)
    if (references.error) throw references.error
    const approvedRooms = new Set((references.data || []).filter(approvedAsset).map(asset => asset.subject))
    const jobs = dueSlots(now).map(slot => ({
      slot_key: `${localDate(now)}:${slot.room}`, room: slot.room,
      title: slot.title, caption: slot.caption, camera_action: slot.action,
      policy_version: CONTENT_POLICY.version, status: approvedRooms.has(slot.room) ? 'planned' : 'blocked',
      blocker: approvedRooms.has(slot.room) ? null : `Approved ${slot.room} venue reference required. Review room references in the admin dashboard.`,
    }))
    if (jobs.length) {
      const { error } = await db.from('cs_content_jobs').upsert(jobs, { onConflict: 'slot_key', ignoreDuplicates: true })
      if (error) throw error
    }
    const { data, error } = await db.from('cs_content_jobs').select('id,title,room,status,blocker').in('status', ['planned', 'blocked']).limit(20)
    if (error) throw error
    // A schedule plans work; the separate worker handles approved media and metered generation.
    let social:unknown
    try {social=await processSocialDelivery()}catch{social={status:'unavailable',error:'Social connection check failed; no automatic submission retry'}}
    return NextResponse.json({ sitePlanned, clipFeaturesPlanned, sitePublished, social, planned_slots: jobs.length, jobs: data, policy: CONTENT_POLICY.version })
  } catch {
    return NextResponse.json({ error: 'Content operation failed; inspect website and generation status before retrying' }, { status: 503 })
  }
}
