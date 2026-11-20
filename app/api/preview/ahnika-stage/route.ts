import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canPreviewAhnikaStage } from '@/lib/events/ahnika-stage-preview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ASSETS = {
  video: { env: 'AHNIKA_STAGE_PREVIEW_VIDEO_PATH', extension: '.mp4' },
  poster: { env: 'AHNIKA_STAGE_PREVIEW_POSTER_PATH', extension: '.png' },
} as const

export async function GET(request: NextRequest) {
  if (!canPreviewAhnikaStage(process.env)) return new NextResponse(null, { status: 404 })

  const asset = request.nextUrl.searchParams.get('asset') as keyof typeof ASSETS | null
  if (!asset || !ASSETS[asset]) return NextResponse.json({ error: 'Invalid preview asset' }, { status: 400 })

  const path = process.env[ASSETS[asset].env]
  if (!path || path.startsWith('/') || path.includes('..') || !path.endsWith(ASSETS[asset].extension) || !/^[a-zA-Z0-9_./-]+$/.test(path)) {
    return NextResponse.json({ error: 'Preview asset unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }

  const db = createAdminClient()
  const signed = await db.storage.from('cafe-sativa-content').createSignedUrl(path, 300)
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json({ error: 'Preview asset unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }

  return NextResponse.redirect(signed.data.signedUrl, {
    status: 307,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
