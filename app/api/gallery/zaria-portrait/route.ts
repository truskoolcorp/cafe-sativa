import { createElement } from 'react'
import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { glyphPortrait, liveGlyphCharacters } from '@/lib/content/glyph-live'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const CHARACTER_ID = 'zaria-solenne'
const ASSET_ID = '473df9fd-b48c-4f01-a89a-499de631b954'
const SHA256 = 'ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca'
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export async function GET() {
  try {
    const source = await liveGlyphCharacters(AbortSignal.timeout(5000))
    const rows = source.characters.filter((row: { id: string }) => row.id === CHARACTER_ID)
    const row = rows[0]
    if (source.live !== true || rows.length !== 1 ||
        row.production_ready !== true || row.rights_status !== 'approved' ||
        row.portrait_available !== true || row.primary_asset_id !== ASSET_ID || row.sha256 !== SHA256) {
      return NextResponse.json({ error: 'Portrait unavailable' }, { status: 404, headers })
    }
    const portrait = await glyphPortrait(CHARACTER_ID, ASSET_ID, SHA256)
    if (!portrait) return NextResponse.json({ error: 'Portrait unavailable' }, { status: 404, headers })
    const image = createElement('div', { style: { display: 'flex', width: '100%', height: '100%', backgroundColor: '#17120f' } },
      createElement('img', { src: `data:${portrait.mime};base64,${portrait.bytes.toString('base64')}`, width: 448, height: 560, style: { objectFit: 'contain' } }))
    // Do not stream master bytes, redirects, or upstream metadata. Materialize the derivative
    // here so an encoder error becomes a controlled fallback rather than a partial response.
    const derivative = await new ImageResponse(image, { width: 448, height: 560 }).arrayBuffer()
    return new NextResponse(derivative, { headers: { ...headers, 'Content-Type': 'image/png' } })
  } catch {
    return NextResponse.json({ error: 'Portrait unavailable' }, { status: 503, headers })
  }
}
