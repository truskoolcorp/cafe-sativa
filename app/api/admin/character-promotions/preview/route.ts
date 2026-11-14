import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** On-demand private preview only. Never approves, publishes or changes a record. */
export async function GET(req: NextRequest) {
  if (!await isContentAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  const id = req.nextUrl.searchParams.get('id')
  if (!id || !uuid.test(id)) return NextResponse.json({ error: 'Valid promotion ID required' }, { status: 400, headers })
  try {
    const db = createAdminClient()
    const result = await db.from('cs_character_promo_drafts').select('id,character_id,video_asset_path').eq('id', id).maybeSingle()
    if (result.error) throw result.error
    const row = result.data
    if (!row?.video_asset_path) return NextResponse.json({ error: 'No stored video for this promotion' }, { status: 404, headers })
    // Only the exact finalized object belonging to this database row may be signed.
    const match = row.video_asset_path.match(/^character-promos\/([a-z0-9][a-z0-9-]*)\/([a-f0-9-]{36})\/([a-f0-9]{64})\.mp4$/)
    if (!match || match[1] !== row.character_id || match[2] !== row.id || row.id !== id) {
      return NextResponse.json({ error: 'Stored media identity needs reconciliation' }, { status: 409, headers })
    }
    const signed = await db.storage.from('cafe-sativa-content').createSignedUrl(row.video_asset_path, 300)
    if (signed.error || !signed.data?.signedUrl) throw Error('Preview unavailable')
    return NextResponse.json({ previewUrl: signed.data.signedUrl, expiresInSeconds: 300 }, { headers })
  } catch {
    return NextResponse.json({ error: 'Private preview unavailable. No records changed.' }, { status: 503, headers })
  }
}
