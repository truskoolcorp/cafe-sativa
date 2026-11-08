import { resolveAllowedOrigin } from '@/lib/cors'

// These documented site aliases are allowed only when the API request is
// actually on that same origin. This does not expand the cross-origin list.
const SUPPORTED_SITE_ALIASES = new Set([
  'https://virtual.cafe-sativa.com',
  'https://virtual-cafe-sativa.vercel.app',
])

export function conciergeOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin || resolveAllowedOrigin(origin)) return true
  if (!SUPPORTED_SITE_ALIASES.has(origin)) return false
  try { return new URL(request.url).origin === origin } catch { return false }
}
