import { planReferencePreviews } from '@/lib/content/reference-previews'
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronAuthorized, isContentAdmin } from '@/lib/content/auth'
import { approvedAsset, CanonicalAsset, compileShot, CONTENT_POLICY } from '@/lib/content/policy'

const BASE = 'https://api.dev.runwayml.com/v1'

export async function processContent(req: NextRequest, pilot = false, collectOnly = false) {
  if (collectOnly && req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({error:'Invalid origin'},{status:403})
  if (collectOnly ? !await isContentAdmin() : !cronAuthorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!collectOnly && !pilot && process.env.CS_CONTENT_GENERATION_ENABLED !== 'true') return NextResponse.json({ mode: 'paused', reason: 'Generation not enabled' })
  const key = process.env.RUNWAYML_API_SECRET
  // Operator sets an all-in conservative quote after verifying provider pricing; no guessed rate.
  const quote = Number(process.env.CS_RUNWAY_FIVE_SECOND_QUOTE_CENTS)
  if (!key || (!collectOnly && (!Number.isInteger(quote) || quote <= 0 || quote > CONTENT_POLICY.monthlyBudgetCents))) {
    return NextResponse.json({ error: 'Verified Runway credential and cost quote required' }, { status: 503 })
  }
  const headers = { Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' }
  try {
    const db = createAdminClient()
    if (!collectOnly) await planReferencePreviews()
    // Recover jobs left in submitting by a runtime interruption. Never resubmit a paid call automatically.
    const stale = new Date(Date.now() - 10 * 60_000).toISOString()
    const recovered = await db.from('cs_content_jobs').update({ status: 'submission_unknown', blocker: 'Interrupted submission; reconcile provider before retrying' }).eq('status', 'submitting').lt('updated_at', stale)
    if (recovered.error) throw recovered.error
    const pending = await db.from('cs_content_jobs').select('*').eq('status', 'generating').limit(5)
    if (pending.error) throw pending.error
    for (const job of pending.data || []) {
      const holdCollection = async (reason: string) => {
        const saved = await db.from('cs_content_jobs').update({ blocker: `${reason}; existing provider task retained, no paid resubmission.` }).eq('id',job.id).eq('status','generating')
        if (saved.error) throw saved.error
      }
      try {
      const response = await fetch(`${BASE}/tasks/${encodeURIComponent(job.provider_task_id)}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      if (!response.ok) {
        const held=await db.from('cs_content_jobs').update({blocker:`Task collection returned HTTP ${response.status}; the existing provider task is retained, with no paid resubmission.`}).eq('id',job.id).eq('status','generating')
        if(held.error)throw held.error
        continue
      }
      const task = await response.json()
      if (['PENDING','THROTTLED','RUNNING'].includes(task.status)) {
        const observed = await db.from('cs_content_jobs').update({blocker:`Provider reports ${task.status}; existing task retained, no paid resubmission.`}).eq('id',job.id).eq('status','generating')
        if(observed.error)throw observed.error
      }
      if (task.status === 'SUCCEEDED' && typeof task.output?.[0] === 'string') {
        const output = new URL(task.output[0])
        if (output.protocol !== 'https:') { await holdCollection('Provider output is not HTTPS'); continue }
        const media = await fetch(output, { signal: AbortSignal.timeout(15_000) })
        if (!media.ok) { await holdCollection(`Generated media download returned HTTP ${media.status}`); continue }
        if (Number(media.headers.get('content-length')) > 50_000_000) { await holdCollection('Generated media exceeds 50 MB'); continue }
        // Bound the stream before buffering provider media.
        if (!media.body) { await holdCollection('Generated media response has no body'); continue }
        const reader = media.body.getReader(), chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 50_000_000) { await reader.cancel(); throw new Error('OUTPUT_TOO_LARGE') }
          chunks.push(part.value)
        }
        const path = `${job.id}.mp4`
        const saved = await db.storage.from('cafe-sativa-content').upload(path, Buffer.concat(chunks), { contentType: 'video/mp4', upsert: true })
        if (saved.error) {
          const held=await db.from('cs_content_jobs').update({blocker:'Generated clip collection could not save private media. Existing provider task retained; no paid resubmission.'}).eq('id',job.id).eq('status','generating')
          if(held.error)throw held.error
          continue
        }
        // Private storage path, not an expiring provider URL. QA must approve before publication.
        const changed = await db.from('cs_content_jobs').update({ status: 'pending_qa', output_url: path, blocker:null, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'generating')
        if (changed.error) throw changed.error
      } else if (task.status === 'SUCCEEDED') {
        await holdCollection('Succeeded provider task has no downloadable output')
      } else if (task.status === 'FAILED' || task.status === 'CANCELED') {
        const changed = await db.from('cs_content_jobs').update({ status: 'failed', blocker: `Provider task ${task.status}; no automatic paid retry` }).eq('id', job.id)
        if (changed.error) throw changed.error
      }
      } catch (error) {
        const name = error instanceof Error ? error.name : ''
        const reason = error instanceof Error && error.message === 'OUTPUT_TOO_LARGE' ? 'Generated media stream exceeds 50 MB' : ['TimeoutError','AbortError'].includes(name) ? 'Provider task or media collection timed out' : 'Provider task or media collection failed; inspect provider and storage availability'
        await holdCollection(reason)
      }
    }
    if (collectOnly) return NextResponse.json({checked:pending.data?.length || 0,submitted:0})
    // Missing references must not starve another room with an approved keyframe.
    const references = await db.from('cs_canonical_assets').select('*').eq('kind', 'venue').eq('active', true)
    if (references.error) throw references.error
    const valid = (references.data || []).filter(asset => approvedAsset(asset as CanonicalAsset)) as CanonicalAsset[]
    const approved = valid.filter(asset => valid.filter(other => other.subject === asset.subject).length === 1)
    const rooms = approved.map(asset => asset.subject)
    const waiting = await db.from('cs_content_jobs').select('id,room,canonical_asset_id').in('status', ['planned','blocked']).limit(100)
    if (waiting.error) throw waiting.error
    const missing = (waiting.data || []).filter(job => !rooms.includes(job.room))
    for (const room of Array.from(new Set(missing.map(job => job.room)))) {
      const marked = await db.from('cs_content_jobs').update({status:'blocked',blocker:`Approved canonical keyframe missing for ${room}`})
        .eq('room',room).in('status',['planned','blocked'])
      if (marked.error) throw marked.error
    }
    if (!rooms.length) return NextResponse.json({submitted:0,reason:'No approved room references',blocked:missing.length})
    const activity=await db.from('cs_content_jobs').select('canonical_asset_id,status,qa_approved_by,qa_approved_at,output_url,estimated_cost_cents').in('canonical_asset_id',approved.map(asset=>asset.id)).in('status',['submitting','generating','pending_qa','submission_unknown','failed','approved','scheduled','published']).limit(1000)
    if(activity.error)throw activity.error
    const reusableMasters=new Set((activity.data || []).filter(row=>['approved','scheduled','published'].includes(row.status) && row.qa_approved_by && row.qa_approved_at && row.output_url).map(row=>row.canonical_asset_id))
    const busyMasters=new Set((activity.data || []).filter(row=>!reusableMasters.has(row.canonical_asset_id)).map(row=>row.canonical_asset_id))
    const eligible=(waiting.data || []).filter(job=>{
      const asset=approved.find(asset=>asset.subject===job.room)
      return asset && !busyMasters.has(asset.id) && (!job.canonical_asset_id || job.canonical_asset_id===asset.id)
    })
    for(const job of waiting.data || []) {
      const asset=approved.find(asset=>asset.subject===job.room)
      const changedMaster=asset && job.canonical_asset_id && job.canonical_asset_id!==asset.id
      if(asset && (changedMaster || busyMasters.has(asset.id))) {
        const held=await db.from('cs_content_jobs').update({status:'blocked',blocker:changedMaster?'This draft uses a replaced master. Review a new version; do not reinterpret the original.':'A take from this master is awaiting review or reconciliation. No duplicate paid generation.'}).eq('id',job.id).in('status',['planned','blocked'])
        if(held.error)throw held.error
      }
    }
    if(!eligible.length)return NextResponse.json({submitted:0,reason:'No eligible room take; review or reconcile existing media first',blocked:missing.length})
    let selection = db.from('cs_content_jobs').select('*').in('status', ['planned', 'blocked']).in('id',eligible.map(job=>job.id))
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
      if (['PENDING','THROTTLED','RUNNING'].includes(task.status)) {
        const observed = await db.from('cs_content_jobs').update({blocker:`Provider reports ${task.status}; existing task retained, no paid resubmission.`}).eq('id',job.id).eq('status','generating')
        if(observed.error)throw observed.error
      }
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
