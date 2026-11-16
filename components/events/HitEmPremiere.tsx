import Link from 'next/link'
import PartyShare from './PartyShare'
import { HIT_EM_PREMIERE, type PublicPremiere } from '@/lib/events/hit-em-premiere'

export default function HitEmPremiere({ event, calendarHref = `${HIT_EM_PREMIERE.path}/calendar` }: { event: PublicPremiere; calendarHref?: string }) {
  if (event.state === 'canceled') return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28 text-foreground">
      <section className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8">
        <h1 className="font-heading text-3xl font-bold">This gathering has been canceled</h1>
        <p className="mt-4 text-muted-foreground">The Café Sativa release gathering is no longer scheduled.</p>
        <Link href="/events" className="mt-6 inline-block text-primary underline">Browse Café Sativa events</Link>
      </section>
    </div>
  )
  const ended = event.status === 'ended'
  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28 text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <Link href="/events" className="text-sm text-primary underline">← Café Sativa events</Link>
        <header className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">Free public premiere gathering</p>
          <h1 className="font-heading text-4xl font-bold sm:text-5xl">{event.title}</h1>
          <p className="text-lg">Wednesday, November 11, 2026 · <time dateTime={event.startsAt}>12:00 AM CST</time></p>
          <p className="text-sm text-muted-foreground">Midnight at the start of Wednesday, November 11. Dallas / America/Chicago time, immediately after Tuesday night.</p>
          <p>No Café Sativa account, membership, ticket, or payment is required.</p>
          {ended && <p role="status" className="rounded-lg border border-border bg-card p-4">This gathering has ended. Video availability is managed by YouTube.</p>}
        </header>

        <section aria-labelledby="premiere-player-heading" className="space-y-4">
          <h2 id="premiere-player-heading" className="font-heading text-2xl font-bold">{ended ? 'Premiere video' : 'Watch the premiere'}</h2>
          <div className="relative overflow-hidden rounded-xl border border-border bg-black" style={{ aspectRatio: '16 / 9' }}>
            <iframe
              src={HIT_EM_PREMIERE.embedUrl}
              title="Hit Em official YouTube premiere"
              className="absolute inset-0 h-full w-full border-0"
              allow="encrypted-media; fullscreen; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
          <p className="text-sm text-muted-foreground">Press play to open YouTube’s player. Before the premiere, it shows the waiting room. YouTube controls when playback begins.</p>
          <a href={HIT_EM_PREMIERE.watchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground">
            {ended ? 'Open the video on YouTube ↗' : 'Watch and join live chat on YouTube ↗'}
          </a>
          <p className="text-sm text-muted-foreground">{ended ? 'Use the YouTube link if the player does not load.' : 'The YouTube link opens the same premiere with its live chat. Posting in chat requires a YouTube sign-in. Use this link on mobile or if the embedded player does not load.'}</p>
        </section>

        {!ended && <section aria-labelledby="join-in-heading" className="rounded-xl border border-border bg-card p-6">
          <h2 id="join-in-heading" className="font-heading text-2xl font-bold">Join the conversation</h2>
          <p className="mt-3">Say hello in the YouTube chat, share where you’re watching from, and tell us which moment stands out.</p>
          <p className="mt-3 text-sm text-muted-foreground">Please keep it welcoming. This is a shared video premiere, with no separate Zoom room or promised live-host session.</p>
          <a href={calendarHref} className="mt-5 inline-flex rounded-lg border border-border px-4 py-2 font-semibold">Add to my calendar (.ics)</a>
          <p className="mt-2 text-xs text-muted-foreground">Downloads a calendar file. Your calendar app controls any reminder; Café Sativa does not subscribe or message you.</p>
        </section>}

        <section aria-labelledby="host-conversation-heading" className="rounded-xl border border-border bg-card p-6">
          <h2 id="host-conversation-heading" className="font-heading text-2xl font-bold">A separate conversation with Café hosts</h2>
          <p className="mt-3">Find Laviche, Ginger, and Ahnika in the “Talk to one of the hosts” section on ASK.</p>
          <p id="host-conversation-help" className="mt-3 text-sm text-muted-foreground">ASK is separate from the YouTube premiere chat. It opens in a new tab so you can keep the premiere open here.</p>
          <a href="/ask?host=laviche" target="_blank" rel="noopener noreferrer" aria-describedby="host-conversation-help" className="mt-5 inline-flex min-h-11 max-w-full items-center rounded-lg border border-border px-4 py-3 font-semibold">
            Talk with Laviche on ASK (new tab) ↗
          </a>
        </section>

        <PartyShare />

        <section aria-labelledby="about-gathering-heading" className="space-y-3">
          <h2 id="about-gathering-heading" className="font-heading text-2xl font-bold">About the gathering</h2>
          {event.description && <p className="whitespace-pre-wrap leading-relaxed">{event.description}</p>}
          <p className="text-sm text-muted-foreground">The video is publicly available on YouTube. Watching here does not make it exclusive to Café Sativa.</p>
        </section>
        <nav aria-label="Explore Café Sativa" className="flex flex-wrap gap-4 border-t border-border pt-6">
          <Link href="/stage" className="text-primary underline">Explore The Stage</Link>
          <Link href="/" className="text-primary underline">Explore Café Sativa</Link>
        </nav>
      </div>
    </div>
  )
}
