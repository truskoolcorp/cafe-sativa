'use client'

import { useRef, useState } from 'react'

// Never copy location.href: previews and incoming URLs can contain private tokens.
const PARTY_URL = 'https://www.cafe-sativa.com/events/hit-em-release-party'

export default function PartyShare() {
  const link = useRef<HTMLInputElement>(null)
  const copying = useRef(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  async function copyLink() {
    if (copying.current) return
    copying.current = true
    setBusy(true)
    setStatus('Copying party link…')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(PARTY_URL)
      setStatus('Party link copied.')
    } catch {
      setStatus('Could not copy automatically. Select and copy the party link below.')
      link.current?.focus()
      link.current?.select()
    } finally {
      copying.current = false
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="party-share-heading" className="space-y-3 rounded-xl border border-border bg-card p-6">
      <h2 id="party-share-heading" className="font-heading text-2xl font-bold">Share the party</h2>
      <button type="button" onClick={copyLink} aria-disabled={busy} className="inline-flex rounded-lg border border-border px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {busy ? 'Copying…' : 'Copy party link'}
      </button>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm">{status}</p>
      <label htmlFor="party-share-link" className="block text-sm font-semibold">Public party link</label>
      <input ref={link} id="party-share-link" type="text" readOnly value={PARTY_URL} onFocus={event => event.currentTarget.select()} aria-describedby="party-share-help" className="block w-full min-w-0 rounded-lg border border-border bg-background p-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
      <p id="party-share-help" className="text-sm text-muted-foreground">You can also select and copy this link to share the Café Sativa party page.</p>
    </section>
  )
}
