import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { durableStatus } from '@/lib/concierge/durable'
import { conciergeCapability, durableMode } from '@/lib/concierge/capability'
import { validateConciergeRequest, conciergeRequesterMatches, conciergeRequesterValid } from '@/lib/concierge/request'
import { conciergeOriginAllowed } from '@/lib/concierge/request-origin'
import { jsonWithCors, preflight } from '@/lib/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

function response(req: Request, body: unknown, status = 200) {
  return jsonWithCors(body, { request: req, status, noStore: true })
}

export async function POST(req: Request) {
  try {
    const result = await handleStatus(req)
    result.headers.set('Cache-Control', 'no-store')
    return result
  } catch {
    return response(req, { error: 'Request status is unavailable.', code: 'status_unavailable' }, 503)
  }
}

async function handleStatus(req: Request) {
  if (!conciergeOriginAllowed(req)) return response(req, { error: 'This chat origin is not allowed.', code: 'origin_not_allowed' }, 403)
  const header = req.headers.get('x-concierge-durable')
  if (header !== null && header !== '0' && header !== '1') return response(req, { error: 'Invalid chat mode header.', code: 'invalid_durable_mode' }, 400)
  if (!conciergeRequesterValid(req)) return response(req, { error: 'The expected chat identity is missing or invalid.', code: 'requester_changed' }, 409)
  const parsed = validateConciergeRequest(await req.json().catch(() => null))
  if (!parsed.valid) return response(req, { error: parsed.error }, 400)
  if (!parsed.body.request_id) return response(req, { error: 'request_id is required.' }, 400)
  // Status remains available in OFF mode and during maintenance for draining or
  // rollback. Never replace the ledger with legacy history or provider work.
  if (durableMode() === 'invalid') return response(req, { error: 'Invalid configuration.', code: 'policy_unavailable' }, 503)
  const { data, error } = await createClient().auth.getUser()
  if (error && error.name !== 'AuthSessionMissingError') return response(req, { error: 'Identity verification is unavailable.', code: 'auth_unavailable' }, 503)
  const userId = data?.user?.id ?? null
  if (!conciergeRequesterMatches(req, userId, parsed.body.session_id)) {
    return response(req, { error: 'The signed-in identity changed. Return to the original account before recovering this message.', code: 'requester_changed' }, 409)
  }
  if (!userId && !parsed.body.session_id) return response(req, { error: 'Missing session.' }, 400)
  return durableStatus({ req, body: parsed.body, admin: createAdminClient(), userId })
}

export async function GET(req: Request) {
  if (!conciergeOriginAllowed(req)) return response(req, { error: 'This chat origin is not allowed.', code: 'origin_not_allowed' }, 403)
  const { invalid, ...capability } = conciergeCapability()
  return invalid ? response(req, { code: 'policy_unavailable', error: 'Text chat configuration is unavailable.' }, 503) : response(req, capability)
}

export async function OPTIONS(req: Request) { return preflight(req, { noStore: true }) }
