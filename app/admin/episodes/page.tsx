'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function EpisodeReview() {
  const [episodes, setEpisodes] = useState<any[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  async function load() {
    try {
      const r = await fetch('/api/admin/episodes', { cache: 'no-store' }), body = await r.json()
      if (!r.ok) throw Error(body.error)
      setEpisodes(body.episodes)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load scripts.') }
  }
  useEffect(() => { void load() }, [])
  async function approve(episode: any) {
    setBusy(episode.id); setError('')
    try {
      const r = await fetch('/api/admin/episodes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: episode.id, hash: episode.hash, confirmScript: confirmed[episode.id] === true }) }), body = await r.json()
      if (!r.ok) throw Error(body.error)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not approve script.') }
    finally { setBusy('') }
  }
  return <main className="mx-auto max-w-5xl px-6 pb-16 pt-28">
    <Link className="underline" href="/admin">← Back to dashboard</Link>
    <h1 className="mt-6 text-3xl font-bold">Character episode scripts</h1>
    <p className="my-4">Review the words and current canonical cast. Script approval does not generate or publish video. No event dates or guest appearances are announced.</p>
    {error && <p role="alert" className="mb-6 text-red-400">{error}</p>}
    <div className="grid gap-6 md:grid-cols-2">{episodes.map(e => <article key={e.id} className="overflow-hidden rounded-xl border border-border bg-card">
      {e.roomUrl && <img src={e.roomUrl} alt={`${e.room} approved concept`} className="aspect-video w-full object-cover" />}
      <div className="p-6"><h2 className="text-xl font-bold">{e.title}</h2>
        <p className="my-3">{e.approvedAt ? 'Script approved' : 'Script awaiting review'} · {e.format}</p>
        <div className="flex gap-4">{e.cast.map((actor: any) => <figure key={actor.id}>
          <img src={`/api/content/glyph/portrait?characterId=${encodeURIComponent(actor.id)}&assetId=${encodeURIComponent(actor.assetId)}`} alt={`${actor.name} canonical portrait`} className="h-20 w-20 rounded-full object-cover" />
          <figcaption>{actor.name}</figcaption></figure>)}</div>
        {e.lines.map((line: any, i: number) => <p className="my-4" key={i}><strong>{e.cast.find((a: any) => a.id === line.speaker)?.name}:</strong> {line.text}</p>)}
        <p className="my-4 text-sm">{e.productionNotes}</p>
        {!e.canonReady && <p className="my-4 text-amber-400">Live references and voices need verification before approval.</p>}
        {!e.approvedAt && <><label className="my-4 flex gap-3"><input type="checkbox" checked={!!confirmed[e.id]} onChange={event => setConfirmed({ ...confirmed, [e.id]: event.target.checked })} />I reviewed and approve this exact script.</label>
          <button className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50" disabled={Boolean(busy) || !confirmed[e.id] || !e.canonReady} onClick={() => approve(e)}>{busy === e.id ? 'Saving…' : 'Approve script'}</button></>}
        <p className="mt-4 text-sm text-muted-foreground">Next: approve the composite keyframe, render, review the clip, then schedule release.</p>
      </div></article>)}</div>
  </main>
}
