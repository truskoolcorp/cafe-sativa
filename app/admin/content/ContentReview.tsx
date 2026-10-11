'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import styles from './review.module.css'

const checks = { geometry: 'Room layout matches the reference', furniture: 'Furniture and materials match', lighting: 'Lighting remains believable and consistent', noPeople: 'No people or invented characters appear', noInventedText: 'No invented logos or distorted text appear', captionAccuracy: 'Caption accurately describes the virtual venue' }
const pilotSlot = '2026-10-07:bar'
const plannerUrl = 'https://app.metricool.com/planner/calendar?blogId=5373515&openWithPostUuid=-6101444496612767856'
const guidance: Record<string, string> = {
  planned: 'Review the reference before starting a clip.',
  blocked: 'Resolve the setup requirements shown below before running this clip.',
  generating: 'The worker checks for finished footage every 15 minutes. Refresh this view for its preview.',
  pending_qa: 'Play the video, compare it with the reference, then complete the checks below.',
  approved: 'Accuracy approval saved. Continue in Website programming to approve the caption and choose its release time.',
  scheduled: 'This clip is scheduled. You can review its delivery details in the planner.',
  published: 'Publication has been recorded. No action is needed.',
  failed: 'This clip needs attention. Review the details before attempting another generation.',
  submission_unknown: 'Submission needs checking before any retry to avoid a duplicate charge.',
}

export default function ContentReview({ jobId, embedded = false, onChanged }: { jobId?: string; embedded?: boolean; onChanged?: () => void } = {}) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [socialPreviews, setSocialPreviews] = useState<Record<string,string>>({})
  async function prepareSocialPreview(jobId: string, format = 'feed') {
    setBusy(true); setError(''); setMessage('')
    try {
      const res=await fetch('/api/content/video-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId,format})})
      const result=await res.json()
      if(!res.ok || !result.url)throw new Error(result.error || 'Preview unavailable')
      setSocialPreviews(current=>({...current,[`${jobId}:${format}`]:result.url})); setMessage(result.message)
    } catch(err) {setError(err instanceof Error?err.message:'Preview unavailable')}
    finally {setBusy(false)}
  }
  const reviewedSources=useRef<Record<string,string>>({})
  const [selected, setSelected] = useState<Record<string, Record<string, boolean>>>({})
  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/content/review', { cache: 'no-store' }), body = await r.json()
      if (!r.ok) throw new Error(body.error)
      const sources:Record<string,string>={}
      for(const job of body.jobs || []) {
        const asset=body.assets?.find((item:any)=>item.id===job.canonical_asset_id)
        sources[job.id]=JSON.stringify([job.output_url,job.status,asset?.id,asset?.sha256,asset?.version,asset?.active,asset?.approved_at])
      }
      const previous=reviewedSources.current
      setSelected(current=>Object.fromEntries(Object.entries(current).filter(([id])=>previous[id]===sources[id] && sources[id])))
      reviewedSources.current=sources
      setData(body); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load review data.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  async function pilot() {
    setBusy(true); setError(''); setMessage('Checking the pilot. Please wait…')
    try {
      const r = await fetch('/api/content/pilot', { method: 'POST' })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error)
      setMessage(body.submitted ? 'Pilot submitted. Check its result shortly.' : body.blocker || 'Pilot checked. See the current status below.')
      await load(); onChanged?.()
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : 'Pilot unavailable.') }
    finally { setBusy(false) }
  }
  async function review(id: string, action: string) {
    const job=data?.jobs.find((item:any)=>item.id===id)
    const asset=data?.assets.find((item:any)=>item.id===job?.canonical_asset_id)
    setBusy(true); setError(''); setMessage('Saving your review…')
    try {
      const r = await fetch('/api/content/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, checks: selected[id], canonicalSnapshot:asset?{id:asset.id,sha256:asset.sha256,version:asset.version}:null }) })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error)
      setSelected({}); setMessage(action === 'approve' ? body.websiteDraftWarning || 'Clip accuracy approved. Open Website programming to review its caption, release time and optional social delivery.' : 'Clip rejected. No automatic paid retry will run.'); await load(); onChanged?.()
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : 'Unable to save review.') }
    finally { setBusy(false) }
  }
  const locked = busy || loading
  const venues = data?.assets.filter((asset: any) => asset.kind === 'venue') || []
  return <main className={styles.page} aria-busy={locked}>
    {!embedded && <Link className={`${styles.button} ${styles.secondary}`} href="/admin">← Back to dashboard</Link>}
    <header className={styles.header}>
      <div><h1>Café Sativa content review</h1><p>Review each clip against its approved reference, then approve it for reuse. Social scheduling is a separate step.</p></div>
      <button className={`${styles.button} ${styles.secondary}`} onClick={load} disabled={locked}>{loading ? 'Refreshing…' : '↻ Refresh previews'}</button>
    </header>
    {error && <div className={`${styles.notice} ${styles.error}`} role="alert"><strong>Action needed</strong><p>{error}</p></div>}
    {message && <div className={`${styles.notice} ${styles.success}`} role="status">{message}</div>}
    {loading && !data && <p role="status">Loading your clips and references…</p>}
    {data && <>
      <div className={styles.summary}><span className={styles.badge}>Recurring generation: {data.generationEnabled ? 'enabled' : 'paused'}</span><span>Monthly generation limit: <strong>${(data.monthlyLimitCents / 100).toFixed(2)}</strong></span></div>
      <p>Reserved this month: <strong>${((data.monthlyReservedCents || 0)/100).toFixed(2)}</strong>. Reservations are conservative generation limits, not provider invoices.</p>
      <h2>Planned content and media</h2>
      {!data.jobs.length && <p>No content planned yet.</p>}
      {data.jobs.filter((job: any) => !jobId || job.id === jobId).map((job: any) => {
        const asset = data.assets.find((a: any) => a.id === job.canonical_asset_id)
        const count = Object.keys(checks).filter(key => selected[job.id]?.[key]).length
        const currentReference=Boolean(asset?.active && asset.approved_by && asset.approved_at && asset.version && /^[a-f0-9]{64}$/.test(asset.sha256 || ''))
        const canApprove = currentReference && !!job.previewUrl && count === Object.keys(checks).length
        return <article id={`job-${job.id}`} key={job.id} className={styles.card}>
          <div className={styles.cardTitle}><h3>{job.title}</h3><span className={`${styles.badge} ${['approved','scheduled','published'].includes(job.status) ? styles.success : ''}`}>{job.status.replaceAll('_', ' ')}</span></div>
          <p className={styles.meta}>{job.slot_key}</p><p>{job.caption}</p>
          <div className={styles.nextAction}><strong>{['scheduled','published'].includes(job.status) ? 'Delivery status' : 'Your next step'}</strong><p>{guidance[job.status] || 'Check the current job status below.'}</p>
            {job.slot_key === pilotSlot && ['planned','blocked','generating'].includes(job.status) && <button className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={pilot}>{busy ? 'Working…' : job.status === 'generating' ? 'Check pilot result →' : 'Run approved 5-second pilot · $1 reserved →'}</button>}
            {job.slot_key === pilotSlot && ['scheduled','published'].includes(job.status) && <a className={`${styles.button} ${styles.primary}`} href={plannerUrl} target="_blank" rel="noreferrer">View scheduled post ↗</a>}
            {job.status === 'approved' && <Link className={`${styles.button} ${styles.primary}`} href="/admin?view=website">Review caption and release time →</Link>}
            {['approved','scheduled','published'].includes(job.status) && <button className={styles.button} disabled={locked} onClick={()=>prepareSocialPreview(job.id)}>Prepare social preview · 4:5</button>}
            {socialPreviews[`${job.id}:feed`] && <a className={`${styles.button} ${styles.primary}`} href={socialPreviews[`${job.id}:feed`]} target="_blank" rel="noreferrer">Open social preview ↗</a>}
            {['approved','scheduled','published'].includes(job.status) && <button className={styles.button} disabled={locked} onClick={()=>prepareSocialPreview(job.id,'landscape')}>Prepare landscape preview · 16:9</button>}
            {socialPreviews[`${job.id}:landscape`] && <a className={`${styles.button} ${styles.primary}`} href={socialPreviews[`${job.id}:landscape`]} target="_blank" rel="noreferrer">Open landscape preview ↗</a>}
            {job.status === 'pending_qa' && <a className={`${styles.button} ${styles.primary}`} href={`#review-${job.id}`}>Complete review below ↓</a>}
          </div>
          {job.blocker && <details className={styles.details}><summary>{job.status === 'scheduled' ? 'Show delivery receipt' : 'Show setup details'}</summary><p>{job.blocker}</p></details>}
          <div className={styles.mediaGrid}>
            {job.previewUrl && <section><h4>Video preview</h4><video src={job.previewUrl} controls preload="metadata" className={styles.media} /><a className={styles.textLink} href={job.previewUrl} target="_blank" rel="noreferrer">Open video in a new tab ↗</a></section>}
            {asset && <section><h4>{currentReference?'Approved reference':'Reference requires attention'}</h4><p className={styles.meta}>Version {asset.version} · {currentReference?'Current approved master':'Approval is blocked; refresh Master References'}</p><img src={asset.url} alt={`Approved ${asset.subject} reference`} className={styles.media} /><a className={styles.textLink} href={asset.url} target="_blank" rel="noreferrer">Open full-size reference ↗</a></section>}
          </div>
          {job.status === 'pending_qa' && <fieldset id={`review-${job.id}`} className={styles.checklist} disabled={locked}>
            <legend>Accuracy review · {count} of {Object.keys(checks).length} complete</legend>
            <p>Check each statement after watching the whole clip.</p>
            {Object.entries(checks).map(([key, label]) => <label key={key} className={styles.check}><input type="checkbox" checked={selected[job.id]?.[key] || false} onChange={e => setSelected(p => ({ ...p, [job.id]: { ...p[job.id], [key]: e.target.checked } }))} /><span>{label}</span></label>)}
            <div className={styles.actions}><button className={`${styles.button} ${styles.approve}`} disabled={locked || !canApprove} aria-describedby={`approve-help-${job.id}`} onClick={() => review(job.id, 'approve')}>{busy ? 'Saving…' : '✓ Approve for reuse'}</button><button className={`${styles.button} ${styles.reject}`} disabled={locked} onClick={() => review(job.id, 'reject')}>Reject clip</button></div>
            <p id={`approve-help-${job.id}`} className={styles.meta}>{!currentReference ? 'A current approved room reference is required before approval.' : !job.previewUrl ? 'Refresh previews to load the video before approval.' : canApprove ? 'Ready to save your approval.' : `Complete all ${Object.keys(checks).length} checks to enable approval.`}</p>
          </fieldset>}
        </article>
      })}
      {!embedded && <h2>Venue references</h2>}
      {!venues.length && <p>No approved venue references registered yet.</p>}
      {!embedded && venues.map((asset: any) => <div className={styles.reference} key={asset.id}><div><strong>{asset.subject}</strong><p className={styles.meta}>{asset.version} · {asset.active && asset.approved_at ? 'Approved' : 'Candidate'}</p></div><a className={`${styles.button} ${styles.secondary}`} href={asset.url} target="_blank" rel="noreferrer">View reference ↗</a></div>)}
    </>}
  </main>
}
