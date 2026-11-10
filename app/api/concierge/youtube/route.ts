import Anthropic from '@anthropic-ai/sdk'
import { HIT_EM_PREMIERE } from '@/lib/events/hit-em-premiere'
import { CONCIERGE_MODEL } from '@/lib/concierge/response-engine'
import { createYoutubeGenerationHandlers, readYoutubeBoundedJson, type YoutubeGenerationDependencies } from '@/lib/concierge/youtube-generation-server'
import { createYoutubeRehearsalHandler } from '@/lib/concierge/youtube-rehearsal-server'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

const SUPABASE_ORIGIN = 'https://nwfxvhqbjtfvoopcadff.supabase.co'
function databaseOrigin(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) throw Error('unavailable')
  const url = new URL(base)
  if (url.origin !== SUPABASE_ORIGIN || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('unavailable')
  return url.origin
}
function configured(): boolean {
  try {
    databaseOrigin()
    return !!process.env.ANTHROPIC_API_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !!process.env.SUPABASE_SERVICE_ROLE_KEY
  } catch { return false }
}

async function rpc(name: 'cs_reserve_youtube_generation' | 'cs_youtube_generation_available' | 'cs_reserve_youtube_rehearsal' | 'cs_reserve_youtube_rehearsal_v2' | 'cs_reserve_youtube_rehearsal_v3', body: unknown, signal: AbortSignal): Promise<boolean> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw Error('unavailable')
  const response = await fetch(`${databaseOrigin()}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
  })
  if (!response.ok || response.redirected) { void response.body?.cancel().catch(() => {}); throw Error('unavailable') }
  const data = await readYoutubeBoundedJson(response, signal, 32)
  if (typeof data !== 'boolean') throw Error('unavailable')
  return data
}

const dependencies: YoutubeGenerationDependencies = {
  // Empty by default. Provisioning this event-scoped service capability is a
  // separate approved action; no default/shared/guest token or key fallback.
  token: () => process.env.LAVICHE_DYNAMIC_BRIDGE_TOKEN,
  configured,
  async readPublicEvent(signal) {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!key) throw Error('unavailable')
    const observedAt = Date.now()
    const url = new URL('/rest/v1/my_events_v', databaseOrigin())
    url.search = new URLSearchParams({ select: 'id,slug,title,status,starts_at,ticket_price_cents',
      id: `eq.${HIT_EM_PREMIERE.eventId}`, slug: `eq.${HIT_EM_PREMIERE.slug}`, status: 'in.(scheduled,live)', limit: '2' }).toString()
    // Anonymous public view only, no user cookies/session, admin event read,
    // descriptions, private canonical data, ASK messages or host conversations.
    const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal })
    if (!response.ok || response.redirected) { void response.body?.cancel().catch(() => {}); throw Error('unavailable') }
    const rows = await readYoutubeBoundedJson(response, signal, 2_048)
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw Error('unavailable')
    const row = rows[0] as Record<string, unknown>
    if (row.id !== HIT_EM_PREMIERE.eventId || row.slug !== HIT_EM_PREMIERE.slug || row.title !== HIT_EM_PREMIERE.title
      || row.ticket_price_cents !== 0 || typeof row.starts_at !== 'string'
      || Date.parse(row.starts_at) !== Date.parse(HIT_EM_PREMIERE.startsAt)
      || (row.status !== 'scheduled' && row.status !== 'live')) throw Error('unavailable')
    return {
      sourcePath: HIT_EM_PREMIERE.path, eventId: row.id, title: row.title, status: row.status,
      startsAt: new Date(row.starts_at).toISOString(), ticketPriceCents: row.ticket_price_cents,
      // These are the reviewed public page's pinned video/timezone policy,
      // not invented video/visibility fields on the database row.
      videoId: HIT_EM_PREMIERE.videoId, timeZone: HIT_EM_PREMIERE.timeZone,
      observedAt, expiresAt: observedAt + 60_000,
    }
  },
  quotaAvailable: signal => rpc('cs_youtube_generation_available', {}, signal),
  reserve: (source, signal) => rpc('cs_reserve_youtube_generation', {
    p_event_id: source.eventId, p_video_id: source.videoId,
    p_source_message_id: source.messageId, p_author_channel_id: source.authorChannelId,
  }, signal),
  complete(request, options) {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key || request.model !== CONCIERGE_MODEL || request.max_tokens > 512 || options.maxRetries !== 0) throw Error('unavailable')
    // At most one generation and one independent review. SDK retries disabled
    // on client AND request; never log provider errors or reflect debug fields.
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: options.timeout })
    return client.messages.create(request, { signal: options.signal, maxRetries: 0, timeout: options.timeout })
  },
}

const handlers = createYoutubeGenerationHandlers({ ...dependencies,
  rehearse: createYoutubeRehearsalHandler({ ...dependencies,
    reserveRehearsal: signal => rpc('cs_reserve_youtube_rehearsal', {}, signal),
    reserveRehearsalV2: signal => rpc('cs_reserve_youtube_rehearsal_v2', {}, signal),
    reserveRehearsalV3: signal => rpc('cs_reserve_youtube_rehearsal_v3', {}, signal),
  }),
})

export const GET = handlers.GET
export const POST = handlers.POST
