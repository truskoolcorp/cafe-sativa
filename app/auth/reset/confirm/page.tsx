'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function PasswordRecoveryConfirm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Checking your recovery link…')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const supabase = createClient()
        const code = new URLSearchParams(window.location.search).get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
          window.history.replaceState({}, '', '/auth/reset/confirm')
        }
        const { data, error } = await supabase.auth.getSession()
        if (error || !data.session) throw new Error('No recovery session')
        if (!cancelled) { setReady(true); setMessage('Choose a new password for your account.') }
      } catch {
        if (!cancelled) setMessage('This recovery link is invalid or expired. Request another link.')
      }
    }
    void check()
    return () => { cancelled = true }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || busy) return
    if (password.length < 8 || password !== confirm) {
      setMessage('Enter matching passwords of at least eight characters.')
      return
    }
    setBusy(true)
    try {
      const { error } = await createClient().auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      setMessage('Your password has been updated. You can now sign in.')
    } catch {
      setMessage('Password update failed. Request a new recovery link if this one expired.')
    } finally { setBusy(false) }
  }

  return <main className="max-w-md mx-auto px-4 py-24">
    <h1 className="font-heading text-3xl font-bold">Choose a new password</h1>
    <p role="status" className="mt-4">{message}</p>
    {ready && !done && <form onSubmit={submit} className="mt-6 space-y-4">
      <label htmlFor="new-password" className="block">New password</label>
      <input id="new-password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full border border-border rounded p-3 bg-background" />
      <label htmlFor="repeat-password" className="block">Confirm new password</label>
      <input id="repeat-password" type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} className="w-full border border-border rounded p-3 bg-background" />
      <button type="submit" disabled={busy} className="rounded bg-primary text-primary-foreground px-5 py-3">{busy ? 'Updating…' : 'Update password'}</button>
    </form>}
    <Link href={done ? '/auth/signin' : '/auth/reset'} className="text-primary underline inline-block mt-8">{done ? 'Sign in' : 'Request another link'}</Link>
  </main>
}
