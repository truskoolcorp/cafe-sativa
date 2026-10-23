import { NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isContentAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const db = createAdminClient()
    const [promos, delivery, rooms, qa] = await Promise.all([
      db.from('cs_character_promo_drafts').select('id,character_id,promo_key,title,specialty,spoken_script,status,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at,updated_at').order('created_at', { ascending: true }).limit(100),
      db.from('cs_character_promo_delivery_plans').select('promo_id,network,scheduled_at,status,provider_receipt').limit(200),
      db.from('cs_room_host_assignments').select('room_key,character_id,role,assignment_status'),
      db.from('cs_character_promo_qa_checks').select('promo_id,video_sha256,check_name,result,reviewer_id').limit(300),
    ])
    if (promos.error || delivery.error || rooms.error || qa.error) throw new Error('Production records unavailable')
    return NextResponse.json({ promos: promos.data, delivery: delivery.data, rooms: rooms.data, qa: qa.data }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Promotion queue unavailable; original records were not modified.' }, { status: 503 })
  }
}
