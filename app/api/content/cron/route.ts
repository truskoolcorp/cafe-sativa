import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronAuthorized } from '@/lib/content/auth'
import { CONTENT_POLICY, dueSlots, localDate } from '@/lib/content/policy'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  try {
    const db = createAdminClient()
    const jobs = dueSlots(now).map(slot => ({
      slot_key: `${localDate(now)}:${slot.room}`, room: slot.room,
      title: slot.title, caption: slot.caption, camera_action: slot.action,
      policy_version: CONTENT_POLICY.version, status: 'planned',
    }))
    if (jobs.length) {
      const { error } = await db.from('cs_content_jobs').upsert(jobs, { onConflict: 'slot_key', ignoreDuplicates: true })
      if (error) throw error
    }
    const { data, error } = await db.from('cs_content_jobs').select('id,title,room,status,blocker').in('status', ['planned', 'blocked']).limit(20)
    if (error) throw error
    // A schedule plans work; the separate worker handles approved media and metered generation.
    return NextResponse.json({ planned_slots: jobs.length, jobs: data, policy: CONTENT_POLICY.version })
  } catch {
    return NextResponse.json({ error: 'Content database unavailable; no generation or publishing attempted' }, { status: 503 })
  }
}
