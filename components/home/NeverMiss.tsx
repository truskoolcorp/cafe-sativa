'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, Mail } from 'lucide-react'

/**
 * Email capture near the bottom of the home page.
 *
 * Writes to /api/waitlist, which persists to the
 * `marketing_emails` Supabase table. Intentionally minimal: one
 * field, one button. An optional "what interests you" select is
 * tempting but proven to tank conversion on first-touch captures
 * — we can segment later based on what events they attend.
 */

type FormState = 'idle' | 'submitting' | 'success' | 'error'

export function NeverMiss() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<FormState>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setState('submitting')
    setMessage(null)

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setState('error')
        setMessage(data?.error || 'Could not sign you up. Try again?')
        return
      }

      setState('success')
      setMessage('You&rsquo;re on the list. See you inside.')
      setEmail('')
    } catch {
      setState('error')
      setMessage('Network error. Please try again.')
    }
  }

  return (
    <section className="py-24 md:py-32 bg-card/30 border-y border-border">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <Mail className="w-8 h-8 text-primary mx-auto mb-6" />
        <h2 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
          Never miss a session.
        </h2>
        <p className="text-base md:text-lg text-muted-foreground font-body mt-4 leading-relaxed">
          One email when something great is about to go live. No filler, no daily
          push notifications.
        </p>

        {state === 'success' ? (
          <div className="mt-10 inline-flex items-center gap-2 text-primary font-body">
            <Check className="w-5 h-5" />
            <span>You&rsquo;re on the list. See you inside.</span>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-10 flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          >
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              disabled={state === 'submitting'}
              aria-label="Your email address"
              className="flex-1"
            />
            <Button type="submit" disabled={state === 'submitting'}>
              {state === 'submitting' ? 'Sending…' : 'Notify me'}
            </Button>
          </form>
        )}

        {state === 'error' && message && (
          <p className="mt-4 text-sm text-destructive font-body">{message}</p>
        )}
      </div>
    </section>
  )
}
