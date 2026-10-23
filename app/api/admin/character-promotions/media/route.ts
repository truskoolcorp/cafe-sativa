import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const approvedTargets: Record<string, string> = {
  '3f85873d-7c7b-48c4-8225-fdf9542d486a': 'andromeda-zouganelis',
  '4c146dda-4e1c-400f-8371-b49c4dc2eed0': 'aurelio',
}
const maxBytes = 90 * 1024 * 1024
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function POST(req: NextRequest) {
  if (!(await isContentAdmin())) return reply({ error: 'Unauthorized' }, 401)
  if (req.headers.get('origin') !== req.nextUrl.origin) return reply({ error: 'Invalid origin' }, 403)
  const statedLength = Number(req.headers.get('content-length') || 0)
  if (statedLength > maxBytes + 65536) return reply({ error: 'MP4 exceeds upload limit' }, 413)
  try {
    const form = await req.formData()
    const id = form.get('promoId')
    const file = form.get('video')
    if (typeof id !== 'string' || !approvedTargets[id] || !(file instanceof File)) return reply({ error: 'Invalid promotion or file' }, 400)
    if (file.size < 1024 || file.size > maxBytes || !file.name.toLowerCase().endsWith('.mp4')) return reply({ error: 'Use an MP4 below 90 MB' }, 400)
    const db = createAdminClient()
    const existing = await db.from('cs_character_promo_drafts').select('id,character_id,video_asset_path,evidence').eq('id',id).single()
    if (existing.error || !existing.data || existing.data.character_id !== approvedTargets[id]) return reply({ error: 'Character assignment changed. Refresh before uploading.' }, 409)
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.toString('ascii',4,8) !== 'ftyp') return reply({ error: 'Not a valid MP4 container' }, 400)
    const sha = createHash('sha256').update(bytes).digest('hex')
    const path = `character-promos/${approvedTargets[id]}/${id}/${sha}.mp4`
    const uploaded = await db.storage.from('cafe-sativa-content').upload(path,bytes,{contentType:'video/mp4',upsert:false})
    if (uploaded.error && !String(uploaded.error.message).toLowerCase().includes('already exists')) return reply({error:'Media storage failed; promotion unchanged.'},503)
    const audit = {previousAssetPath:existing.data.video_asset_path, uploadedSha256:sha, uploadedAt:new Date().toISOString(),source:'authenticated admin MP4 upload'}
    const updated = await db.from('cs_character_promo_drafts').update({
      video_asset_path:path,
      voice_approved_at:null,
      video_qa_approved_at:null,
      publication_approved_at:null,
      evidence:{...(existing.data.evidence || {}), latestMediaReplacement:audit},
      updated_at:new Date().toISOString()
    }).eq('id',id).eq('character_id',approvedTargets[id]).select('id,video_asset_path').single()
    if(updated.error) return reply({error:'MP4 stored, but record update failed. Do not retry until reconciled.',sha256:sha},503)
    return reply({stored:true,sha256:sha,record:updated.data,qaRequired:true,publicationScheduled:false})
  } catch {
    return reply({error:'Upload failed; no publication or approval was attempted.'},503)
  }
}
