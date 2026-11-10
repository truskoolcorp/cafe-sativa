import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrivateProgrammingError, recommendPrivateCatalogMusic } from '@/lib/content/private-programming'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
export async function POST(req: NextRequest) {
  if (!await isContentAdmin()) return json({ error: 'Unauthorized' }, 401)
  if (req.headers.get('origin') !== req.nextUrl.origin) return json({ error: 'Invalid origin' }, 403)
  if (Number(req.headers.get('content-length')) > 1500) return json({ error: 'Request too large' }, 413)
  const b = await req.json().catch(() => null)
  if (!b || typeof b.month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(b.month)) return json({ error: 'Provide a valid proposed month' }, 400)
  try {
    const result = await recommendPrivateCatalogMusic(createAdminClient(), b.month, 'manual')
    if (result.status === 'existing') return json({ error: 'That month already has a musical proposal or inventory concept', proposal: result.proposal }, 409)
    if (result.status === 'empty_catalog') return json({ error: 'No catalog-based candidates found' }, 404)
    return json({ proposal: result.proposal, evidenceScope: 'internal release inventory only', engagementAnalyzed: false, publicEventCreated: false, productionApproved: false, renderingStarted: false, publishingStarted: false }, 201)
  } catch (error) {
    return json({ error: 'Could not prepare private recommendation', stage: error instanceof PrivateProgrammingError ? error.stage : 'database_setup' }, 503)
  }
}
