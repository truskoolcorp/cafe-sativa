import { planReferencePreviews } from '@/lib/content/reference-previews'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronAuthorized } from '@/lib/content/auth'
import { approvedAsset, CONTENT_POLICY, dueSlots, localDate } from '@/lib/content/policy'

import { planSiteContent, publishDueSiteContent } from '@/lib/content/site'
import { planApprovedClipFeatures } from '@/lib/content/clip-features'
import { planPrivateProgramming, PrivateProgrammingError, type PrivateProgrammingResult } from '@/lib/content/private-programming'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  const completedStages: string[] = []
  let privateProgramming: PrivateProgrammingResult | { status: 'failed'; detail: string }
  try {
    privateProgramming = await planPrivateProgramming(now)
    completedStages.push('private_programming')
  } catch (error) {
    // Private ideas are independent of the established media/site pipeline.
    // Report this failure after giving all existing content stages their turn.
    privateProgramming = { status: 'failed', detail: error instanceof PrivateProgrammingError ? error.stage : 'database_setup' }
  }
  let stage = 'reference_previews'
  try {
    const referencePreviewsPlanned=await planReferencePreviews()
    completedStages.push(stage)
    stage = 'site_planning'
    const sitePlanned = await planSiteContent(now)
    completedStages.push(stage)
    stage = 'clip_features'
    const clipFeaturesPlanned = await planApprovedClipFeatures(now)
    completedStages.push(stage)
    stage = 'site_publishing'
    const sitePublished = await publishDueSiteContent(now)
    completedStages.push(stage)
    stage = 'content_slots'
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
    // Social receipts and dispatch have their own guarded cron endpoint.
    // Keep the general content planner independent of provider OAuth health.
    completedStages.push(stage)
    const summary = { privateProgramming, referencePreviewsPlanned, sitePlanned, clipFeaturesPlanned, sitePublished, social: {status:'managed_by_dedicated_delivery_cron'}, planned_slots: jobs.length, jobs: data, policy: CONTENT_POLICY.version }
    if (privateProgramming.status === 'failed') {
      return NextResponse.json({ ...summary, error: 'Private programming planning failed; existing content stages completed.', partialFailure: true, stage: 'private_programming', detail: privateProgramming.detail, completedStages }, { status: 503 })
    }
    return NextResponse.json(summary)
  } catch (error) {
    return NextResponse.json({ error: 'Content operation failed; earlier stages may have completed. Inspect status before retrying.', stage, completedStages, privateProgramming }, { status: 503 })
  }
}
