'use client'

import { useEffect, useState } from 'react'

const endpoint = '/api/stage/rehearsal-report'

export function StageDressReport({ messageId, onHidden }: { messageId: string; onHidden: () => void }) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function report() {
    if (busy || submitted) return
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId }),
      })
      const data = await res.json()
      if (!res.ok) { setStatus(data.error || 'Could not send the report.'); return }
      setSubmitted(true)
      if (data.status === 'hidden_by_laviche' || data.status === 'hidden_by_staff') onHidden()
      else setStatus(data.status === 'dismissed' ? 'Report already reviewed.' : 'Sent for moderator review.')
    } catch { setStatus('Could not send the report.') }
    finally { setBusy(false) }
  }

  return <div className="flex gap-2 text-xs">
    <button type="button" className="underline text-muted-foreground" disabled={busy || submitted} onClick={report}>
      {submitted ? 'Reported' : 'Report message'}
    </button>
    {status && <span role="status">{status}</span>}
  </div>
}

type Item = { id: string; content: string }
export function useStageDressHiddenMessages(enabled: boolean) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (!enabled) return
    const abort = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(endpoint + '?mode=hidden', { signal: abort.signal, cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!abort.signal.aborted && Array.isArray(data.hidden)) {
          setHidden(prior => new Set([...prior, ...data.hidden.filter((id: unknown) => typeof id === 'string')]))
        }
      } catch { /* Keep prior hidden message IDs during a retry. */ }
    }
    void load()
    const timer = setInterval(load, 2000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [enabled])
  return { hidden, hide: (id: string) => setHidden(prior => new Set([...prior, id])) }
}

export function StageDressModerationQueue({ onHidden }: { onHidden: (messageId: string) => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const abort = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(endpoint, { signal: abort.signal, cache: 'no-store' })
        if (res.ok && !abort.signal.aborted) {
          const data = await res.json()
          if (!abort.signal.aborted && Array.isArray(data.items)) setItems(data.items)
        }
      } catch { /* A transient request cannot resolve or drop a report. */ }
    }
    void load()
    const timer = setInterval(load, 5000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [])

  async function review(messageId: string, action: 'remove' | 'dismiss') {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, action }),
      })
      if (!res.ok) { setStatus('Could not resolve this report.'); return }
      setItems(previous => previous.filter(item => item.id !== messageId))
      if (action === 'remove') onHidden(messageId)
      setStatus(action === 'remove' ? 'Reported message removed.' : 'Report dismissed.')
    } catch { setStatus('Could not resolve this report.') }
    finally { setBusy(false) }
  }

  return <details className="text-sm">
    <summary>Rehearsal reports for staff review ({items.length})</summary>
    {items.map(item => <div key={item.id} className="space-x-2 py-2">
      <p className="whitespace-pre-wrap break-words">{item.content}</p>
      <button type="button" className="underline" disabled={busy} onClick={() => review(item.id, 'remove')}>Remove message</button>
      <button type="button" className="underline" disabled={busy} onClick={() => review(item.id, 'dismiss')}>Dismiss report</button>
    </div>)}
    {status && <p role="status">{status}</p>}
  </details>
}
