'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const checks = { geometry: 'Room layout matches the reference', furniture: 'Furniture and materials match', lighting: 'Lighting remains believable and consistent', noPeople: 'No people or invented characters appear', noInventedText: 'No invented logos or distorted text appear', captionAccuracy: 'Caption accurately describes the virtual venue' }

export default function ContentReview() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Record<string, Record<string, boolean>>>({})
  async function load() {
    try {
      const r = await fetch('/api/content/review', { cache: 'no-store' }), body = await r.json()
      if (!r.ok) throw new Error(body.error)
      setData(body); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load review data.') }
  }
  useEffect(() => { void load() }, [])
  async function review(id: string, action: string) {
    setBusy(true)
    try {
      const r = await fetch('/api/content/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, checks: selected[id] }) })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error)
      setSelected({}); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save review.') }
    finally { setBusy(false) }
  }
  return <main style={{ maxWidth: 1000, margin: 'auto', padding: 24, color: '#eee', background: '#161008', minHeight: '100vh' }}>
    <Link href="/admin">← Content calendar</Link>
    <h1>Café Sativa content review</h1>
    <p>Compare each clip with its approved venue reference. Approval adds it to the reusable media library. Social delivery is not connected yet.</p>
    {error && <p role="alert">{error}</p>}
    <button onClick={load} disabled={busy}>Refresh previews</button>
    {data && <>
      <p>Generation: {data.generationEnabled ? 'enabled' : 'paused'} · Monthly generation limit: ${(data.monthlyLimitCents / 100).toFixed(2)}</p>
      <h2>Venue references</h2>
      {!data.assets.length && <p>No approved venue references yet. Recovered floor plans disagree; final layout selection is pending.</p>}
      {data.assets.map((asset: any) => <p key={asset.id}>{asset.subject} · {asset.version} · {asset.active && asset.approved_at ? 'Approved' : 'Candidate'}</p>)}
      <h2>Planned content and media</h2>
      {!data.jobs.length && <p>No content planned yet.</p>}
      {data.jobs.map((job: any) => {
        const asset = data.assets.find((a: any) => a.id === job.canonical_asset_id)
        return <article key={job.id} style={{ border: '1px solid #b8813a', padding: 16, marginBottom: 16 }}>
          <h3>{job.title}</h3><p>{job.slot_key} · {job.status.replaceAll('_', ' ')}</p><p>{job.caption}</p>
          {job.blocker && <p>{job.blocker}</p>}
          {job.previewUrl && <video src={job.previewUrl} controls preload="metadata" style={{ maxWidth: '100%', maxHeight: 420 }} />}
          {asset && <div><p>Reference: {asset.subject} · {asset.version}</p><img src={asset.url} alt={`Approved ${asset.subject} reference`} style={{ maxWidth: '100%', maxHeight: 300 }} /></div>}
          {job.status === 'pending_qa' && <fieldset disabled={busy}>
            <legend>Accuracy review</legend>
            {Object.entries(checks).map(([key, label]) => <label key={key} style={{ display: 'block', margin: '10px 0' }}><input type="checkbox" checked={selected[job.id]?.[key] || false} onChange={e => setSelected(p => ({ ...p, [job.id]: { ...p[job.id], [key]: e.target.checked } }))} /> {label}</label>)}
            <button disabled={!job.previewUrl || !Object.keys(checks).every(key => selected[job.id]?.[key])} onClick={() => review(job.id, 'approve')}>Approve for reuse</button>{' '}
            <button onClick={() => review(job.id, 'reject')}>Reject clip</button>
          </fieldset>}
        </article>
      })}
    </>}
  </main>
}
