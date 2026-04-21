import { NextResponse } from 'next/server'

/**
 * Cross-origin support for the concierge and related APIs.
 *
 * The concierge route is called from two origins:
 *   - cafe-sativa.com itself (same-origin, no CORS needed)
 *   - mall.truskool.net (cross-origin, CORS required)
 *
 * Anything else should be denied — we don't want random sites to
 * embed our concierge and rack up token spend on our account.
 *
 * Policy:
 *   - Known origins → echo back the Origin value in allow-origin
 *   - Unknown origins → no allow-origin header (browser blocks)
 *
 * Echoing the Origin value (rather than '*') is required because we
 * do NOT allow credentials cross-origin, but it's still good practice
 * to be specific about which origin we're trusting per request.
 */
const ALLOWED_ORIGINS = new Set([
  'https://cafe-sativa.com',
  'https://www.cafe-sativa.com',
  'https://mall.truskool.net',
  // Mall preview deployments on Vercel — use a regex in resolveOrigin
  // for the *.vercel.app subdomain match rather than listing every
  // preview URL.
])

const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  // Local dev
  /^http:\/\/localhost:\d+$/,
  // Mall preview deploys
  /^https:\/\/tru-skool-mall-[a-z0-9-]+\.vercel\.app$/,
  // Cafe-sativa preview deploys (for testing)
  /^https:\/\/virtual-cafe-sativa-[a-z0-9-]+\.vercel\.app$/,
]

export function resolveAllowedOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null
  if (ALLOWED_ORIGINS.has(requestOrigin)) return requestOrigin
  for (const pattern of ALLOWED_ORIGIN_PATTERNS) {
    if (pattern.test(requestOrigin)) return requestOrigin
  }
  return null
}

/**
 * Returns the CORS headers for a response, given the request's Origin.
 * Callers should spread this into their NextResponse.json headers.
 */
export function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowed = resolveAllowedOrigin(requestOrigin)
  if (!allowed) return {}

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Concierge-Debug',
    'Access-Control-Max-Age': '86400',
    // We don't use cookies cross-origin (the concierge accepts an
    // anonymous session_id from the mall), so credentials stay off.
    // If this ever changes, we'd also have to switch off wildcarding.
    'Vary': 'Origin',
  }
}

/**
 * Standard preflight handler. Wraps NextResponse with the right
 * headers when the Origin is allowed; returns 204 either way (a
 * browser sees the missing allow-origin and blocks the real request).
 */
export function preflight(req: Request): NextResponse {
  const origin = req.headers.get('origin')
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  })
}

/**
 * Helper to attach CORS headers to a JSON response. Use this instead
 * of NextResponse.json directly in routes that support CORS.
 */
export function jsonWithCors(
  data: unknown,
  init: { status?: number; request: Request }
): NextResponse {
  const origin = init.request.headers.get('origin')
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: corsHeaders(origin),
  })
}
