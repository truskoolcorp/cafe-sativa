'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AHNIKA_STAGE_CANARY } from '@/lib/events/ahnika-stage-preview'

const reactions = ['Love it', 'Encore', 'Smooth'] as const

export default function AhnikaStageCanary() {
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [queued, setQueued] = useState<string[]>([])

  function rehearseMessage() {
    const value = message.trim()
    if (!value) return
    setQueued((current) => [...current, value])
    setMessage('')
  }

  return (
    <main className="min-h-screen bg-background px-4 pb-16 pt-28 text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <aside className="rounded-xl border border-primary/50 bg-card p-4" aria-label="Private preview notice">
          <strong>Private Stage canary. This page does not publish the performance.</strong>
          <p className="mt-2 text-sm text-muted-foreground">Noindex, preview-branch only. Audience interactions below stay in this browser and are never sent or stored.</p>
        </aside>

        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-primary">Café Sativa · The Stage</p>
          <h1 className="font-heading text-4xl font-bold sm:text-5xl">{AHNIKA_STAGE_CANARY.title}</h1>
          <p className="text-lg text-muted-foreground">{AHNIKA_STAGE_CANARY.subtitle}</p>
        </header>

        <section aria-labelledby="performance-heading" className="space-y-4">
          <h2 id="performance-heading" className="font-heading text-2xl font-bold">Private playback test</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-black" style={{ aspectRatio: '16 / 9' }}>
            <video
              className="h-full w-full object-contain"
              controls
              controlsList="nodownload"
              disablePictureInPicture
              playsInline
              preload="metadata"
              poster="/api/preview/ahnika-stage?asset=poster"
              src="/api/preview/ahnika-stage?asset=video"
              aria-label="Ahnika Merlot performing Already Gone on the Café Sativa Stage"
            />
          </div>
          <p className="text-sm text-muted-foreground">The player uses short-lived links to approved private storage. The performance file is not committed to the public repository.</p>
        </section>

        <section className="grid gap-6 md:grid-cols-2" aria-label="Audience interaction rehearsal">
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-heading text-2xl font-bold">Audience reactions</h2>
            <p className="mt-2 text-sm text-muted-foreground">Local canary controls for mobile spacing, keyboard access, and feedback states.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {reactions.map((reaction) => (
                <button
                  key={reaction}
                  type="button"
                  aria-pressed={selected === reaction}
                  onClick={() => setSelected(reaction)}
                  className="min-h-11 rounded-full border border-border px-4 py-2 font-semibold aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  {reaction}
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm" role="status">{selected ? `Selected: ${selected}` : 'No reaction selected.'}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-heading text-2xl font-bold">Moderated chat rehearsal</h2>
            <label htmlFor="canary-message" className="mt-3 block text-sm font-semibold">Test audience message</label>
            <textarea
              id="canary-message"
              value={message}
              maxLength={280}
              onChange={(event) => setMessage(event.target.value)}
              className="mt-2 min-h-24 w-full rounded-lg border border-border bg-background p-3"
              placeholder="Write a local test message…"
            />
            <button type="button" onClick={rehearseMessage} className="mt-3 min-h-11 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">Send to local moderation queue</button>
            <p className="mt-2 text-xs text-muted-foreground">Local rehearsal only. Nothing is transmitted.</p>
            <ul className="mt-4 space-y-2" aria-live="polite">
              {queued.map((item, index) => <li key={`${item}-${index}`} className="rounded-lg border border-border p-3 text-sm">Pending moderator review: {item}</li>)}
            </ul>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-heading text-xl font-bold">Production disclosure</h2>
          <p className="mt-3 text-sm text-muted-foreground">{AHNIKA_STAGE_CANARY.disclosure}</p>
        </section>

        <nav className="flex flex-wrap gap-4 border-t border-border pt-6" aria-label="Canary navigation">
          <Link href="/stage" className="text-primary underline">View the current public Stage</Link>
          <Link href="/" className="text-primary underline">Return to Café Sativa</Link>
        </nav>
      </div>
    </main>
  )
}
