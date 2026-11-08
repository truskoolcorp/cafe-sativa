import { conciergeCapability } from '@/lib/concierge/capability'
import { conciergeOriginAllowed } from '@/lib/concierge/request-origin'
import { jsonWithCors, preflight } from '@/lib/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

function response(req: Request, body: unknown, status = 200) {
  return jsonWithCors(body, { request: req, status, noStore: true })
}

export async function GET(req: Request) {
  if (!conciergeOriginAllowed(req)) {
    return response(req, { error: 'This chat origin is not allowed.', code: 'origin_not_allowed' }, 403)
  }
  const { invalid, ...capability } = conciergeCapability()
  if (invalid) return response(req, { code: 'policy_unavailable', error: 'Text chat configuration is unavailable.' }, 503)
  return response(req, capability)
}

// This build has no ledger. Never query legacy conversation history as a
// substitute, echo request content, grant replay, or assert a terminal result.
export async function POST(req: Request) {
  if (!conciergeOriginAllowed(req)) {
    return response(req, { error: 'This chat origin is not allowed.', code: 'origin_not_allowed' }, 403)
  }
  return response(req, { error: 'Request status is unavailable on this deployment. Keep the original request.', code: 'status_unavailable' }, 503)
}

export async function OPTIONS(req: Request) {
  return preflight(req, { noStore: true })
}
