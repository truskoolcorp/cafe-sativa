'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function PasswordRecoveryRequest() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: new URL('/auth/reset/confirm', window.location.origin).toString(),
      })
      if (error) throw error
      setMessage('If an account exists for that email, recovery instructions will be sent.')
    } catch {
      setMessage('Recovery could not be requested. Please try again later.')
    } finally { setBusy(false) }
  }
  return <form onSubmit={submit} className="mt-6 space-y-4">
    <label htmlFor="recovery-email" className="block font-semibold">Email address</label>
    <input id="recovery-email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full p-3 rounded border border-border bg-background" disabled={busy} />
    <button type="submit" disabled={busy} className="rounded bg-primary px-5 py-3 text-primary-foreground">{busy ? 'Sending…' : 'Send recovery link'}</button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>
}
