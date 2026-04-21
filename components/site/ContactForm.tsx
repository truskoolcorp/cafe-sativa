'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Client-side contact form. Kept separate from the page wrapper so
 * `useSearchParams()` has a clean Suspense boundary (Next requires
 * this at build time or static generation bails out).
 */

const TOPICS = [
  { value: 'general', label: 'General inquiry' },
  { value: 'artist', label: 'Artist submission (Gallery)' },
  { value: 'chef', label: 'Chef / culinary collaboration' },
  { value: 'performer', label: 'Musician / performer inquiry' },
  { value: 'press', label: 'Press & media' },
  { value: 'partnership', label: 'Partnership / sponsorship' },
  { value: 'venue-tenerife', label: 'Tenerife venue (2026)' },
  { value: 'technical', label: 'Technical issue with the site' },
]

type FormState = 'idle' | 'submitting' | 'success' | 'error'

export function ContactForm() {
  const searchParams = useSearchParams()
  const initialTopic = searchParams.get('topic') || 'general'

  const [topic, setTopic] = useState(initialTopic)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<FormState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (initialTopic && TOPICS.some((t) => t.value === initialTopic)) {
      setTopic(initialTopic)
    }
  }, [initialTopic])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setState('submitting')
    setErrorMessage(null)

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, topic, subject, message }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setState('error')
        setErrorMessage(data?.error || 'Something went wrong. Please try again.')
        return
      }

      setState('success')
    } catch {
      setState('error')
      setErrorMessage('Network error. Please try again.')
    }
  }

  if (state === 'success') {
    return (
      <div className="border border-primary/40 bg-card rounded-xl p-12 text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center mx-auto mb-6">
          <Check className="w-6 h-6 text-primary" />
        </div>
        <h2 className="font-heading text-3xl font-bold text-foreground mb-3">
          Message received.
        </h2>
        <p className="text-base text-muted-foreground font-body max-w-md mx-auto">
          We&rsquo;ll reply within a few days. For urgent technical issues, message our
          AI host on the Ask page — it&rsquo;s live 24/7.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label
          htmlFor="topic"
          className="block text-sm font-body font-semibold text-foreground mb-2"
        >
          What&rsquo;s this about?
        </label>
        <select
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={state === 'submitting'}
          className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-body ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-body font-semibold text-foreground mb-2"
          >
            Your name
          </label>
          <Input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={state === 'submitting'}
            autoComplete="name"
          />
        </div>
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-body font-semibold text-foreground mb-2"
          >
            Email
          </label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={state === 'submitting'}
            autoComplete="email"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="subject"
          className="block text-sm font-body font-semibold text-foreground mb-2"
        >
          Subject <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={state === 'submitting'}
          placeholder="A short line to help us sort this"
        />
      </div>

      <div>
        <label
          htmlFor="message"
          className="block text-sm font-body font-semibold text-foreground mb-2"
        >
          Message
        </label>
        <textarea
          id="message"
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={state === 'submitting'}
          rows={6}
          className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-body ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {state === 'error' && errorMessage && (
        <p className="text-sm text-destructive font-body">{errorMessage}</p>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={state === 'submitting'}
        className="w-full sm:w-auto"
      >
        {state === 'submitting' ? (
          'Sending…'
        ) : (
          <>
            Send message
            <Send className="w-4 h-4 ml-2" />
          </>
        )}
      </Button>
    </form>
  )
}
