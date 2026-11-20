import { NextRequest, NextResponse } from 'next/server'
import { canPreviewAhnikaStage } from '@/lib/events/ahnika-stage-preview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ASSETS = new Set(['video', 'poster'])

export async function GET(request: NextRequest) {
  if (!canPreviewAhnikaStage(process.env)) return new NextResponse(null, { status: 404 })

  const asset = request.nextUrl.searchParams.get('asset')
  if (!asset || !ASSETS.has(asset)) return NextResponse.json({ error: 'Invalid preview asset' }, { status: 400 })

  const relayUrl = process.env.AHNIKA_STAGE_RELAY_URL
  const relayKey = process.env.AHNIKA_STAGE_RELAY_KEY
  if (!relayUrl || !relayKey) {
    return NextResponse.json({ error: 'Preview asset unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }

  const relay = await fetch(`${relayUrl}?asset=${asset}`, {
    headers: { 'x-canary-key': relayKey },
    cache: 'no-store',
  })
  if (!relay.ok) {
    return NextResponse.json({ error: 'Preview asset unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }

  const payload = (await relay.json()) as { url?: string }
  if (!payload.url?.startsWith('https://ekaukffotzujkkpdvpgj.supabase.co/storage/v1/object/sign/')) {
    return NextResponse.json({ error: 'Preview asset unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }

  return NextResponse.redirect(payload.url, {
    status: 307,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
