import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { EPISODE_BRIEFS, episodeHash, episodeCanonMatches } from '@/lib/content/episode-briefs'
import { liveGlyphCharacters } from '@/lib/content/glyph-live'

export const dynamic = 'force-dynamic'
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET() {
  if (!await isContentAdmin()) return response({ error: 'Administrator access required.' }, 401)
  try {
    const db = createAdminClient()
    const [canon, rooms, approvals] = await Promise.all([
      liveGlyphCharacters().catch(() => null),
      db.from('cs_canonical_assets').select('id,subject,url,sha256,active,approved_by,approved_at').in('id', EPISODE_BRIEFS.map(b => b.roomAssetId)),
      db.from('cs_episode_script_approvals').select('episode_id,script_sha256,approved_at'),
    ])
    if (rooms.error || approvals.error) throw Error('Episode records unavailable')
    return response({ episodes: EPISODE_BRIEFS.map(brief => {
      const hash = episodeHash(brief), room = rooms.data.find(r => r.id === brief.roomAssetId)
      return { ...brief, hash, roomUrl: room?.url, canonReady: Boolean(canon?.live && episodeCanonMatches(brief, canon.characters, room)),
        approvedAt: approvals.data.find(a => a.episode_id === brief.id && a.script_sha256 === hash)?.approved_at || null }
    }) })
  } catch { return response({ error: 'Episode review is temporarily unavailable.' }, 503) }
}

export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) return response({ error: 'Invalid origin.' }, 403)
  if (!await isContentAdmin()) return response({ error: 'Administrator access required.' }, 401)
  const body = await req.json().catch(() => null)
  const brief = EPISODE_BRIEFS.find(b => b.id === body?.episodeId)
  if (!brief || body?.hash !== episodeHash(brief) || body?.confirmScript !== true) return response({ error: 'Review the current script and confirm approval.' }, 409)
  try {
    const db = createAdminClient()
    const [canon, room, auth] = await Promise.all([
      liveGlyphCharacters(), db.from('cs_canonical_assets').select('*').eq('id', brief.roomAssetId).maybeSingle(), createClient().auth.getUser(),
    ])
    if (!auth.data.user) return response({ error: 'Sign in again.' }, 401)
    if (room.error) throw Error('Room unavailable')
    if (!canon.live || !episodeCanonMatches(brief, canon.characters, room.data)) return response({ error: 'Current approved references or voices changed or are unavailable. Refresh and reconcile before approving.' }, 409)
    const saved = await db.from('cs_episode_script_approvals').upsert({ episode_id: brief.id, script_sha256: episodeHash(brief), brief,
      approved_by: auth.data.user.id, approved_at: new Date().toISOString() }, { onConflict: 'episode_id' })
    if (saved.error) throw Error('Approval not saved')
    return response({ approved: true, message: 'Script approved. Composite keyframe, rendering, final clip review and release scheduling remain separate.' })
  } catch { return response({ error: 'Could not verify references or save approval. No generation was submitted.' }, 503) }
}
