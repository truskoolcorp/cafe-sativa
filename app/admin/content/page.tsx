'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from './review.module.css'

const checks = { geometry: 'Room layout matches the reference', furniture: 'Furniture and materials match', lighting: 'Lighting remains believable and consistent', noPeople: 'No people or invented characters appear', noInventedText: 'No invented logos or distorted text appear', captionAccuracy: 'Caption accurately describes the virtual venue' }
const pilotSlot = '2026-10-07:bar'
const plannerUrl = 'https://app.metricool.com/planner/calendar?blogId=5373515&openWithPostUuid=-6101444496612767856'
const guidance: Record<string, string> = {
  planned: 'Review the reference before starting a clip.',
  blocked: 'Resolve the setup requirements shown below before running this clip.',
  generating: 'Your clip is rendering. Check its result to retrieve the preview.',
  pending_qa: 'Play the video, compare it with the reference, then complete the checks below.',
  approved: 'Your approval is saved. This clip is ready for scheduling.',
  scheduled: 'This clip is scheduled. You can review its delivery details in the planner.',
  published: 'Publication has been recorded. No action is needed.',
  failed: 'This clip needs attention. Review the details before attempting another generation.',
  submission_unknown: 'Submission needs checking before any retry to avoid a duplicate charge.',
}

export default function ContentReview() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Record<string, Record<string, boolean>>>({})
  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/content/review', { cache: 'no-store' }), body = await r.json()
      if (!r.ok) throw new Error(body.error)
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
      await load()
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : 'Pilot unavailable.') }
    finally { setBusy(false) }
  }
  async function review(id: string, action: string) {
    setBusy(true); setError(''); setMessage('Saving your review…')
    try {
      const r = await fetch('/api/content/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, checks: selected[id] }) })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error)
      setSelected({}); setMessage(action === 'approve' ? 'Approval saved. The clip is ready for reuse and scheduling.' : 'Clip rejected. No automatic paid retry will run.'); await load()
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : 'Unable to save review.') }
    finally { setBusy(false) }
  }
  const locked = busy || loading
  const venues = data?.assets.filter((asset: any) => asset.kind === 'venue') || []
  return <main className={styles.page} aria-busy={locked}>
    <Link className={`${styles.button} ${styles.secondary}`} href="/admin/archive">View historical drafts</Link>
    <header className={styles.header}>
      <div><h1>Café Sativa content review</h1><p>Review each clip against its approved reference, then approve it for reuse. Social scheduling is a separate step.</p></div>
      <button className={`${styles.button} ${styles.secondary}`} onClick={load} disabled={locked}>{loading ? 'Refreshing…' : '↻ Refresh previews'}</button>
    </header>
    {error && <div className={`${styles.notice} ${styles.error}`} role="alert"><strong>Action needed</strong><p>{error}</p></div>}
    {message && <div className={`${styles.notice} ${styles.success}`} role="status">{message}</div>}
    {loading && !data && <p role="status">Loading your clips and references…</p>}
    {data && <>
      <div className={styles.summary}><span className={styles.badge}>Recurring generation: {data.generationEnabled ? 'enabled' : 'paused'}</span><span>Monthly generation limit: <strong>${(data.monthlyLimitCents / 100).toFixed(2)}</strong></span></div>
      <h2>Planned content and media</h2>
      {!data.jobs.length && <p>No content planned yet.</p>}
      {data.jobs.map((job: any) => {
        const asset = data.assets.find((a: any) => a.id === job.canonical_asset_id)
        const count = Object.keys(checks).filter(key => selected[job.id]?.[key]).length
        const canApprove = !!job.previewUrl && count === Object.keys(checks).length
        return <article key={job.id} className={styles.card}>
          <div className={styles.cardTitle}><h3>{job.title}</h3><span className={`${styles.badge} ${['approved','scheduled','published'].includes(job.status) ? styles.success : ''}`}>{job.status.replaceAll('_', ' ')}</span></div>
          <p className={styles.meta}>{job.slot_key}</p><p>{job.caption}</p>
          <div className={styles.nextAction}><strong>{['scheduled','published'].includes(job.status) ? 'Delivery status' : 'Your next step'}</strong><p>{guidance[job.status] || 'Check the current job status below.'}</p>
            {job.slot_key === pilotSlot && ['planned','blocked','generating'].includes(job.status) && <button className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={pilot}>{busy ? 'Working…' : job.status === 'generating' ? 'Check pilot result →' : 'Run approved 5-second pilot · $1 reserved →'}</button>}
            {job.slot_key === pilotSlot && ['scheduled','published'].includes(job.status) && <a className={`${styles.button} ${styles.primary}`} href={plannerUrl} target="_blank" rel="noreferrer">View scheduled post ↗</a>}
            {job.status === 'pending_qa' && <a className={`${styles.button} ${styles.primary}`} href={`#review-${job.id}`}>Complete review below ↓</a>}
          </div>
          {job.blocker && <details className={styles.details}><summary>{job.status === 'scheduled' ? 'Show delivery receipt' : 'Show setup details'}</summary><p>{job.blocker}</p></details>}
          <div className={styles.mediaGrid}>
            {job.previewUrl && <section><h4>Video preview</h4><video src={job.previewUrl} controls preload="metadata" className={styles.media} /><a className={styles.textLink} href={job.previewUrl} target="_blank" rel="noreferrer">Open video in a new tab ↗</a></section>}
            {asset && <section><h4>Approved reference</h4><img src={asset.url} alt={`Approved ${asset.subject} reference`} className={styles.media} /><a className={styles.textLink} href={asset.url} target="_blank" rel="noreferrer">Open full-size reference ↗</a></section>}
          </div>
          {job.status === 'pending_qa' && <fieldset id={`review-${job.id}`} className={styles.checklist} disabled={locked}>
            <legend>Accuracy review · {count} of {Object.keys(checks).length} complete</legend>
            <p>Check each statement after watching the whole clip.</p>
            {Object.entries(checks).map(([key, label]) => <label key={key} className={styles.check}><input type="checkbox" checked={selected[job.id]?.[key] || false} onChange={e => setSelected(p => ({ ...p, [job.id]: { ...p[job.id], [key]: e.target.checked } }))} /><span>{label}</span></label>)}
            <div className={styles.actions}><button className={`${styles.button} ${styles.approve}`} disabled={locked || !canApprove} aria-describedby={`approve-help-${job.id}`} onClick={() => review(job.id, 'approve')}>{busy ? 'Saving…' : '✓ Approve for reuse'}</button><button className={`${styles.button} ${styles.reject}`} disabled={locked} onClick={() => review(job.id, 'reject')}>Reject clip</button></div>
            <p id={`approve-help-${job.id}`} className={styles.meta}>{!job.previewUrl ? 'Refresh previews to load the video before approval.' : canApprove ? 'Ready to save your approval.' : `Complete all ${Object.keys(checks).length} checks to enable approval.`}</p>
          </fieldset>}
        </article>
      })}
      <h2>Venue references</h2>
      {!venues.length && <p>No approved venue references registered yet.</p>}
      {venues.map((asset: any) => <div className={styles.reference} key={asset.id}><div><strong>{asset.subject}</strong><p className={styles.meta}>{asset.version} · {asset.active && asset.approved_at ? 'Approved' : 'Candidate'}</p></div><a className={`${styles.button} ${styles.secondary}`} href={asset.url} target="_blank" rel="noreferrer">View reference ↗</a></div>)}
    </>}
  </main>
}
