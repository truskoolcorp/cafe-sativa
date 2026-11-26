import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { glyphPortrait, liveGlyphCharacters } from '@/lib/content/glyph-live'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const CHARACTER_ID = 'zaria-solenne'
const ASSET_ID = '473df9fd-b48c-4f01-a89a-499de631b954'
const SHA256 = 'ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export async function GET() {
  let phase: 'metadata' | 'asset' | 'encode' = 'metadata'
  let signal = AbortSignal.timeout(12000)
  try {
    const source = await liveGlyphCharacters(signal)
    const rows = source.characters.filter((row: { id: string }) => row.id === CHARACTER_ID)
    const row = rows[0]
    if (source.live !== true || rows.length !== 1 ||
        row.production_ready !== true || row.rights_status !== 'approved' ||
        row.portrait_available !== true || row.primary_asset_id !== ASSET_ID || row.sha256 !== SHA256) {
      return NextResponse.json({ error: 'Portrait unavailable' }, { status: 404, headers })
    }
    phase = 'asset'
    signal = AbortSignal.timeout(10000)
    const portrait = await glyphPortrait(CHARACTER_ID, ASSET_ID, SHA256, signal)
    if (!portrait) return NextResponse.json({ error: 'Portrait unavailable' }, { status: 404, headers })
    phase = 'encode'
    const { bytes, mime } = portrait
    const format = mime === 'image/png' && bytes.subarray(0, 8).equals(PNG_SIGNATURE) ? 'png'
      : mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpeg'
      : mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null
    if (!format) throw new Error('Unsupported portrait format')
    const input = sharp(bytes, { limitInputPixels: 16_000_000, pages: 1, failOn: 'warning' })
    const meta = await input.metadata()
    if (meta.format !== format || !meta.width || !meta.height) throw new Error('Invalid portrait')
    const derivative = await input.autoOrient()
      .resize(448, 560, { fit: 'contain', background: '#17120f' })
      .toColourspace('srgb').flatten({ background: '#17120f' })
      .png().toBuffer()
    return new NextResponse(new Uint8Array(derivative), { headers: { ...headers, 'Content-Type': 'image/png' } })
  } catch {
    console.warn('gallery_zaria_portrait', phase === 'encode' ? 'encode_failed' : phase + (signal.aborted ? '_timeout' : '_invalid'))
    return NextResponse.json({ error: 'Portrait unavailable' }, { status: 503, headers })
  }
}
