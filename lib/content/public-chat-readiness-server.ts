import 'server-only'
import { liveGlyphCharacters } from './glyph-live'
import { HIT_EM_PREMIERE, publicHitEmPremiere } from '../events/hit-em-premiere'
import { createTrustedPublicChatProviders } from './public-chat-attestation-adapter'
import { createBoundedPublicChatReadiness, readBoundedPublicChatJson } from './public-chat-readiness-resources'

/** Dormant fixed server factory. Not imported by runtime. No calls at construction.
 * Public anonymous REST only: no cookies, session, service-role or admin client.
 * Existing environment variable NAMES only; values are not inspected by this module
 * until an approved future request. Deployment credentials/RLS remain unverified.
 */
export function createFixedServerReadiness(approval: unknown) {
  const preflight = () => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!base || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.GLYPH_CANON_READ_TOKEN) throw Error('unavailable')
    const url = new URL(base)
    if (url.origin !== 'https://nwfxvhqbjtfvoopcadff.supabase.co' || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('unavailable')
  }
  const now = () => { preflight(); return Date.now() }
  const providers = (signal: AbortSignal) => createTrustedPublicChatProviders({
    now,
    liveGlyphCharacters: () => liveGlyphCharacters(signal),
    async loadHitEmPremiere() {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!base || !key) throw Error('unavailable')
      const url = new URL(base)
      if (url.origin !== 'https://nwfxvhqbjtfvoopcadff.supabase.co' || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('unavailable')
      url.pathname = '/rest/v1/my_events_v'
      url.search = new URLSearchParams({ select: 'id,slug,title,description,status,starts_at,ticket_price_cents', id: `eq.${HIT_EM_PREMIERE.eventId}`, slug: `eq.${HIT_EM_PREMIERE.slug}`, status: 'in.(scheduled,live)', limit: '2' }).toString()
      const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal })
      const rows = await readBoundedPublicChatJson(response, signal)
      if (!Array.isArray(rows) || rows.length !== 1) throw Error('unavailable')
      return publicHitEmPremiere(rows[0])
    },
  })
  return createBoundedPublicChatReadiness(approval, {
    now,
    readCanon: signal => providers(signal).readCanon(),
    readEvent: signal => providers(signal).readEvent(),
  })
}
