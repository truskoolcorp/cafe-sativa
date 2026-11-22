'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function UsernameForm({ initialUsername }: { initialUsername: string | null }) {
  const [active, setActive] = useState(initialUsername)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  async function save(username: string | null) {
    setSaving(true)
    setError('')
    setStatus('')
    try {
      const response = await fetch('/api/lounge/username', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }),
      })
      const data = await response.json()
      if (!response.ok || typeof data.username !== 'string') throw new Error(data.error || 'Couldn’t save your username.')
      setActive(data.username)
      setValue('')
      setStatus(`Saved. You’ll appear in chat as ${data.username}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your username.')
    } finally {
      setSaving(false)
    }
  }

  return <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={event => {
    event.preventDefault()
    if (value.trim() && !saving) void save(value)
  }}>
    <p>{active ? <>Current username: <strong>{active}</strong></> : 'You can choose a username or let us generate one.'}</p>
    <label htmlFor="chat-username" className="block font-semibold">Choose a username</label>
    <p id="username-rules" className="text-sm text-muted-foreground">3–24 characters. Start with a letter. Letters, numbers, hyphens and underscores only. Names aren’t case-sensitive.</p>
    <input id="chat-username" aria-describedby="username-rules" autoComplete="off" autoCapitalize="none" spellCheck={false}
      value={value} onChange={event => setValue(event.target.value)} maxLength={24} disabled={saving}
      className="w-full rounded-lg border border-border bg-background px-3 py-2" />
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={saving || !value.trim()}>Save username</Button>
      {!active && <Button type="button" variant="outline" disabled={saving} onClick={() => save(null)}>Generate one for me</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-foreground">{error}</p>}
    <p role="status" className={status ? 'text-sm text-primary' : 'sr-only'}>{status}</p>
  </form>
}
