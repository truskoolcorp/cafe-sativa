import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { durableStatus, durableMode, textMaintenance } from '@/lib/concierge/durable'
import { validateConciergeRequest, conciergeRequesterMatches } from '@/lib/concierge/request'
import { conciergeOriginAllowed } from '@/lib/concierge/request-origin'
import { jsonWithCors, preflight } from '@/lib/cors'
export const runtime = 'nodejs'
export async function POST(req: Request) {
  if (!conciergeOriginAllowed(req)) return jsonWithCors({ error: 'This chat origin is not allowed.', code: 'origin_not_allowed' }, { request: req, status: 403 })
  const parsed = validateConciergeRequest(await req.json().catch(() => null))
  if (!parsed.valid) return jsonWithCors({ error: parsed.error }, { request: req, status: 400 })
  // Status remains available when admissions are disabled for draining/rollback.
  // No provider work occurs here; absent migration/RPC fails closed.
  if (durableMode() === 'invalid') return jsonWithCors({ error: 'Invalid configuration.', code: 'policy_unavailable' }, { request: req, status: 503 })
  try {
    const { data, error } = await createClient().auth.getUser()
    if (error && error.name !== 'AuthSessionMissingError') throw new Error('Auth unavailable')
    const userId = data?.user?.id ?? null
    if (!userId && !parsed.body.session_id) return jsonWithCors({ error: 'Missing session.' }, { request: req, status: 400 })
    if (!conciergeRequesterMatches(req, userId, parsed.body.session_id)) {
      return jsonWithCors({ error: 'The signed-in identity changed. Return to the original account before recovering this message.', code: 'requester_changed' }, { status: 409, request: req })
    }
    return durableStatus({ req, body: parsed.body, admin: createAdminClient(), userId })
  } catch {
    return jsonWithCors({ error: 'Request status is unavailable.', code: 'status_unavailable' }, { request: req, status: 503 })
  }
}
export async function OPTIONS(req: Request) { return preflight(req) }

// Authoritative capability, not a public build-time flag that could drift from
// the worker configuration. The durable request header also fences mode changes.
export async function GET(req: Request) {
  if (!conciergeOriginAllowed(req)) return jsonWithCors({ error: 'Origin not allowed.' }, { request: req, status: 403 })
  const mode = durableMode(), maintenance = textMaintenance()
  const invalid = mode === 'invalid' || maintenance === 'invalid'
  const response = jsonWithCors(invalid ? { code: 'policy_unavailable' } : { durable_enabled: mode === 'on',
    durable_payload_version: 2, text_admissions_enabled: maintenance === 'off' },
    { request: req, status: invalid ? 503 : 200 })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
