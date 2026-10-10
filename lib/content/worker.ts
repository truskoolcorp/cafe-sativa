import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronAuthorized } from '@/lib/content/auth'
import { approvedAsset, CanonicalAsset, compileShot, CONTENT_POLICY } from '@/lib/content/policy'

const BASE = 'https://api.dev.runwayml.com/v1'

export async function processContent(req: NextRequest, pilot = false) {
  if (!cronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!pilot && process.env.CS_CONTENT_GENERATION_ENABLED !== 'true') return NextResponse.json({ mode: 'paused', reason: 'Generation not enabled' })
  const key = process.env.RUNWAYML_API_SECRET
  // Operator sets an all-in conservative quote after verifying provider pricing; no guessed rate.
  const quote = Number(process.env.CS_RUNWAY_FIVE_SECOND_QUOTE_CENTS)
  if (!key || !Number.isInteger(quote) || quote <= 0 || quote > CONTENT_POLICY.monthlyBudgetCents) {
    return NextResponse.json({ error: 'Verified Runway credential and cost quote required' }, { status: 503 })
  }
  const headers = { Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' }
  try {
    const db = createAdminClient()
    // Recover jobs left in submitting by a runtime interruption. Never resubmit a paid call automatically.
    const stale = new Date(Date.now() - 10 * 60_000).toISOString()
    const recovered = await db.from('cs_content_jobs').update({ status: 'submission_unknown', blocker: 'Interrupted submission; reconcile provider before retrying' }).eq('status', 'submitting').lt('updated_at', stale)
    if (recovered.error) throw recovered.error
    const pending = await db.from('cs_content_jobs').select('*').eq('status', 'generating').limit(5)
    if (pending.error) throw pending.error
    for (const job of pending.data || []) {
      const response = await fetch(`${BASE}/tasks/${encodeURIComponent(job.provider_task_id)}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) continue
      const task = await response.json()
      if (task.status === 'SUCCEEDED' && typeof task.output?.[0] === 'string') {
        const output = new URL(task.output[0])
        if (output.protocol !== 'https:') continue
        const media = await fetch(output, { signal: AbortSignal.timeout(15_000) })
        if (!media.ok || Number(media.headers.get('content-length')) > 50_000_000) continue
        // Bound the stream before buffering provider media.
        if (!media.body) continue
        const reader = media.body.getReader(), chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 50_000_000) { await reader.cancel(); throw new Error('Output too large') }
          chunks.push(part.value)
        }
        const path = `${job.id}.mp4`
        const saved = await db.storage.from('cafe-sativa-content').upload(path, Buffer.concat(chunks), { contentType: 'video/mp4', upsert: true })
        if (saved.error) continue
        // Private storage path, not an expiring provider URL. QA must approve before publication.
        const changed = await db.from('cs_content_jobs').update({ status: 'pending_qa', output_url: path, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'generating')
        if (changed.error) throw changed.error
      } else if (task.status === 'FAILED' || task.status === 'CANCELED') {
        const changed = await db.from('cs_content_jobs').update({ status: 'failed', blocker: `Provider task ${task.status}; no automatic paid retry` }).eq('id', job.id)
        if (changed.error) throw changed.error
      }
    }
    // Missing references must not starve another room with an approved keyframe.
    const references = await db.from('cs_canonical_assets').select('*').eq('kind', 'venue').eq('active', true)
    if (references.error) throw references.error
    const approved = (references.data || []).filter(asset => approvedAsset(asset as CanonicalAsset)) as CanonicalAsset[]
    const rooms = approved.map(asset => asset.subject)
    const waiting = await db.from('cs_content_jobs').select('id,room').in('status', ['planned','blocked']).limit(100)
    if (waiting.error) throw waiting.error
    const missing = (waiting.data || []).filter(job => !rooms.includes(job.room))
    for (const room of Array.from(new Set(missing.map(job => job.room)))) {
      const marked = await db.from('cs_content_jobs').update({status:'blocked',blocker:`Approved canonical keyframe missing for ${room}`})
        .eq('room',room).in('status',['planned','blocked'])
      if (marked.error) throw marked.error
    }
    if (!rooms.length) return NextResponse.json({submitted:0,reason:'No approved room references',blocked:missing.length})
    let selection = db.from('cs_content_jobs').select('*').in('status', ['planned', 'blocked']).in('room',rooms)
    if (pilot) selection = selection.eq('slot_key', '2026-10-07:bar')
    const selected = await selection.order('created_at').limit(1)
    if (selected.error) throw selected.error
    const job = selected.data?.[0]
    if (!job) return NextResponse.json({ processed: true, submitted: 0, blocked:missing.length })
    const asset = approved.find(asset => asset.subject === job.room) || null
    const block = async (reason: string) => {
      const changed = await db.from('cs_content_jobs').update({ status: 'blocked', blocker: reason }).eq('id', job.id).in('status', ['planned', 'blocked'])
      if (changed.error) throw changed.error
      return NextResponse.json({ submitted: 0, blocker: reason })
    }
    if (!approvedAsset(asset) || !asset) return block(`Approved canonical keyframe missing for ${job.room}`)
    if (job.policy_version !== CONTENT_POLICY.version) return block('Job uses an outdated content policy')
    const reusable = await db.from('cs_content_jobs').select('output_url').eq('canonical_asset_id', asset.id)
      .in('status', ['approved','scheduled','published']).not('qa_approved_by', 'is', null)
      .not('qa_approved_at', 'is', null).not('output_url', 'is', null).limit(1)
    if (reusable.error) throw reusable.error
    if (reusable.data?.[0]?.output_url) {
      const reused = await db.from('cs_content_jobs').update({
        canonical_asset_id: asset.id, output_url: reusable.data[0].output_url,
        status: 'pending_qa', blocker: 'Approved media reused; review current caption and delivery time',
      }).eq('id', job.id).in('status', ['planned','blocked'])
      if (reused.error) throw reused.error
      return NextResponse.json({ submitted: 0, reused: 1, job_id: job.id })
    }
    const origin = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!origin || !asset.url.startsWith(`${origin.replace(/\/$/, '')}/storage/v1/object/public/cafe-sativa-canon/`)) return block('Canonical must be in the verified venue reference bucket')
    const reference = await fetch(asset.url, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
    const mime = reference.headers.get('content-type')?.split(';')[0]
    if (!reference.ok || !['image/png','image/jpeg','image/webp'].includes(mime || '')) return block('Canonical reference unavailable or not an image')
    if (!reference.body) return block('Canonical has no image data')
    const reader = reference.body.getReader(), parts: Uint8Array[] = []
    let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 10_000_000) { await reader.cancel(); return block('Canonical exceeds 10 MB') }
      parts.push(part.value)
    }
    const bytes = Buffer.concat(parts)
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) return block('Canonical checksum changed')
    const body = compileShot(asset, job.camera_action)
    // Submit the exact verified bytes so the provider cannot fetch a changed reference later.
    body.promptImage = `data:${mime};base64,${bytes.toString('base64')}`
    const claim = await db.rpc('cs_claim_generation', { job_id: job.id, cost_cents: quote, asset_id: asset.id })
    if (claim.error) throw claim.error
    if (claim.data !== true) return NextResponse.json({ submitted: 0, reason: 'Budget, canonical, or concurrent-claim guard blocked submission' })
    try {
      const response = await fetch(`${BASE}/image_to_video`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error('Provider response requires reconciliation')
      const task = await response.json()
      if (typeof task.id !== 'string' || !task.id) throw new Error('Missing task ID')
      const saved = await db.from('cs_content_jobs').update({ status: 'generating', provider_task_id: task.id, updated_at: new Date().toISOString() }).eq('id', job.id)
      if (saved.error) throw saved.error
      return NextResponse.json({ submitted: 1, job_id: job.id })
    } catch {
      await db.from('cs_content_jobs').update({ status: 'submission_unknown', blocker: 'Check provider task before retry; budget remains reserved' }).eq('id', job.id)
      return NextResponse.json({ error: 'Submission needs reconciliation; no automatic retry' }, { status: 502 })
    }
  } catch {
    return NextResponse.json({ error: 'Content worker unavailable; inspect configuration and job state' }, { status: 503 })
  }
}
