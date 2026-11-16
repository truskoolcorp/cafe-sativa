import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { approvedAsset } from '@/lib/content/policy'

export const dynamic = 'force-dynamic'
const ROOM = /^[a-z][a-z0-9_-]{1,63}$/
function authorized(req: NextRequest) {
  const secret = process.env.CAFE_CANON_READ_TOKEN
  if (!secret || secret.length < 32) return false
  const incoming = req.headers.get('authorization') || ''
  const expected = Buffer.from('Bearer ' + secret)
  const actual = Buffer.from(incoming)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function respond(body: unknown, status = 200) {
  return NextResponse.json(body, {status, headers: {'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex'}})
}
export async function GET(req: NextRequest) {
  if (!authorized(req)) return respond({error:'Unauthorized'},401)
  const subject = req.nextUrl.searchParams.get('room') || ''
  const media = req.nextUrl.searchParams.get('media') === '1'
  if (!ROOM.test(subject)) return respond({error:'invalid_room'},400)
  try {
    const db = createAdminClient()
    const record = await db.from('cs_canonical_assets').select('id,kind,subject,url,sha256,version,approved_by,approved_at,active')
      .eq('kind','venue').eq('subject',subject).eq('active',true).maybeSingle()
    if (record.error || !record.data || !approvedAsset(record.data)) return respond({error:'approved_venue_master_unavailable'},409)
    const asset = record.data
    if (!media) return respond({ready:true, asset:{id:asset.id,kind:asset.kind,subject:asset.subject,sha256:asset.sha256,version:asset.version,approved_at:asset.approved_at}})
    // Download from our fixed canonical bucket only. Never fetch a DB-supplied URL.
    const url = new URL(asset.url)
    const marker = '/storage/v1/object/public/cafe-sativa-canon/'
    const offset = url.pathname.indexOf(marker)
    if (offset < 0) return respond({error:'canonical_storage_path_invalid'},409)
    const path = decodeURIComponent(url.pathname.slice(offset + marker.length))
    const legacyBar = asset.id === 'f493531a-c7e0-4e89-afbb-f2095b914a63' && subject === 'bar' && asset.version === '2026-10-07-empty-room-pilot' && asset.sha256 === 'b6ae58d3151e7b93bd03f2dc55bae1424c03f8307c67dc9affb88fd0831720a9' && path === 'bar-pilot-2026-10-07.png'
    if (!legacyBar && (!/^reviewed\/venue\/[a-z0-9_-]+-[a-f0-9]{64}\.(png|jpg|webp)$/.test(path) || !path.includes('/'+subject+'-'+asset.sha256+'.'))) return respond({error:'canonical_storage_path_invalid'},409)
    const fetched = await db.storage.from('cafe-sativa-canon').download(path)
    if (fetched.error || !fetched.data) return respond({error:'canonical_storage_unavailable'},503)
    const bytes=Buffer.from(await fetched.data.arrayBuffer())
    if (!bytes.length || bytes.length > 10_000_000 || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) return respond({error:'canonical_hash_mismatch'},409)
    const mime=path.endsWith('.png')?'image/png':path.endsWith('.webp')?'image/webp':'image/jpeg'
    return new NextResponse(bytes, {status:200,headers:{'Content-Type':mime,'Cache-Control':'private, no-store','X-Canonical-Sha256':asset.sha256,'X-Canonical-Asset-Id':asset.id,'X-Canonical-Version':asset.version,'X-Robots-Tag':'noindex'}})
  } catch {return respond({error:'canonical_registry_unavailable'},503)}
}

