'use client'

import { useState } from 'react'
import Link from 'next/link'
import { stageProgramStatusLabel, validStageProgram, type StageProgram } from '@/lib/events/stage-program'

export default function StageProgramCanary({ program }: { program: StageProgram }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [queued, setQueued] = useState<string[]>([])

  if (!validStageProgram(program)) throw new Error('Invalid Stage canary program')

  function rehearseMessage() {
    const value = message.trim()
    if (!value) return
    setQueued((current) => [...current, value])
    setMessage('')
  }

  const verifiedCtas = program.ctas.filter((cta) => cta.verification === 'verified')
  const heldCtas = program.ctas.filter((cta) => cta.verification === 'held')

  return (
    <main className="min-h-screen bg-background px-4 pb-16 pt-28 text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <aside className="rounded-xl border border-primary/50 bg-card p-4" aria-label="Private preview notice">
          <strong>{stageProgramStatusLabel(program)}. This page does not publish the performance.</strong>
          <p className="mt-2 text-sm text-muted-foreground">Noindex, preview-branch only. Reactions and messages below stay in this browser and are not production interaction evidence.</p>
        </aside>

        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-primary">Café Sativa · The Stage</p>
          <h1 className="font-heading text-4xl font-bold sm:text-5xl">{program.title}</h1>
          <p className="text-lg text-muted-foreground">{program.subtitle}</p>
        </header>

        <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="lobby-heading">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">Pre-show lobby</p>
          <h2 id="lobby-heading" className="mt-2 font-heading text-2xl font-bold">Welcome to the performance</h2>
          <p className="mt-3 text-sm text-muted-foreground">{program.lobby.accessibility}</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
            {program.lobby.chatRules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
          {!program.lobby.startsAt && <p className="mt-4 text-sm font-semibold">Premiere time remains held until the owner-approved schedule is bound.</p>}
        </section>

        <section aria-labelledby="performance-heading" className="space-y-4">
          <h2 id="performance-heading" className="font-heading text-2xl font-bold">Private playback test</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-black" style={{ aspectRatio: '16 / 9' }}>
            <video className="h-full w-full object-contain" controls controlsList="nodownload" disablePictureInPicture playsInline preload="metadata" poster={program.media.poster} src={program.media.video} aria-label={program.media.accessibleLabel} />
          </div>
          <p className="text-sm text-muted-foreground">The player uses short-lived links to approved private storage. A successful preview is not a public-release receipt.</p>
        </section>

        <section className="grid gap-6 md:grid-cols-2" aria-label="Audience interaction rehearsal">
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-heading text-2xl font-bold">Audience reactions</h2>
            <p className="mt-2 text-sm text-muted-foreground">Local controls verify mobile spacing, keyboard access, and feedback states.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {program.interaction.reactions.map((reaction) => <button key={reaction} type="button" aria-pressed={selected === reaction} onClick={() => setSelected(reaction)} className="min-h-11 rounded-full border border-border px-4 py-2 font-semibold aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">{reaction}</button>)}
            </div>
            <p className="mt-4 text-sm" role="status">{selected ? `Selected: ${selected}` : 'No reaction selected.'}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-heading text-2xl font-bold">Moderated chat rehearsal</h2>
            <label htmlFor="canary-message" className="mt-3 block text-sm font-semibold">Test audience message</label>
            <textarea id="canary-message" value={message} maxLength={280} onChange={(event) => setMessage(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-border bg-background p-3" placeholder="Write a local test message…" />
            <button type="button" onClick={rehearseMessage} className="mt-3 min-h-11 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">Send to local moderation queue</button>
            <p className="mt-2 text-xs text-muted-foreground">Local rehearsal only. Production chat remains held until authentication, rate limits, report/remove controls, and audit storage are verified.</p>
            <ul className="mt-4 space-y-2" aria-live="polite">{queued.map((item, index) => <li key={`${item}-${index}`} className="rounded-lg border border-border p-3 text-sm">Pending moderator review: {item}</li>)}</ul>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="cta-heading">
          <h2 id="cta-heading" className="font-heading text-2xl font-bold">Artist and program links</h2>
          {verifiedCtas.map((cta) => <a key={cta.id} href={cta.destination} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">{cta.label}</a>)}
          {heldCtas.map((cta) => <p key={cta.id} className="mt-4 rounded-lg border border-amber-500/50 p-4 text-sm"><strong>{cta.label} held:</strong> {cta.heldReason}</p>)}
          {!verifiedCtas.length && <p className="mt-3 text-sm text-muted-foreground">Playback remains available while unverified destinations fail closed.</p>}
        </section>

        <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="replay-heading">
          <h2 id="replay-heading" className="font-heading text-xl font-bold">Replay state</h2>
          <p className="mt-3 text-sm text-muted-foreground">{program.replay.status === 'ready' && program.replay.href ? 'Verified replay available.' : 'Replay is not published. It remains held until the premiere completes and the recording is reconciled.'}</p>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-heading text-xl font-bold">Production disclosure</h2>
          <p className="mt-3 text-sm text-muted-foreground">{program.disclosure}</p>
        </section>

        <nav className="flex flex-wrap gap-4 border-t border-border pt-6" aria-label="Canary navigation">
          <Link href="/stage" className="text-primary underline">View the current public Stage</Link>
          <Link href="/" className="text-primary underline">Return to Café Sativa</Link>
        </nav>
      </div>
    </main>
  )
}
