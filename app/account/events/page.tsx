import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatEventDate, type EventRow } from '@/lib/events'

export const dynamic = 'force-dynamic'

/** Upcoming event access personalized by my_events_v, not ticket history. */
export default async function MyEventsPage() {
  const { data: { user }, error } = await createClient().auth.getUser()
  if (error || !user) redirect('/auth/signin?redirect=%2Faccount%2Fevents')
  const { data, error: eventsError } = await createClient().from('my_events_v').select('*').gte('starts_at', new Date().toISOString()).order('starts_at', { ascending: true }).limit(25)
  const events = (data ?? []) as EventRow[]
  return <main className="max-w-5xl mx-auto px-4 py-20">
    <p className="uppercase text-xs tracking-widest text-primary">Your Café Sativa</p>
    <h1 className="font-heading text-4xl font-bold mt-3">Upcoming events and access</h1>
    <p className="text-muted-foreground mt-4">Your current membership-aware access to upcoming events. This is not a history of tickets purchased or confirmed reservations.</p>
    {eventsError ? <p role="alert" className="mt-8">Event access is temporarily unavailable. Please try again later.</p> : events.length === 0 ? <p role="status" className="mt-8">No confirmed upcoming events are listed right now.</p> :
      <ul className="grid md:grid-cols-2 gap-5 mt-8">{events.map(event =>
        <li key={event.id} className="rounded-xl border border-border bg-card p-6">
          <p className="text-xs uppercase text-primary">{event.category?.replaceAll('_',' ') || 'Event'}</p>
          <h2 className="font-heading text-xl font-semibold mt-2">{event.title}</h2>
          <p className="text-sm text-muted-foreground mt-2">{formatEventDate(event.starts_at).date} · {formatEventDate(event.starts_at).time}</p>
          <p className="text-sm mt-3">Access: {event.access.replaceAll('_',' ')}</p>
          <Link href={`/events/${encodeURIComponent(event.slug)}`} className="inline-block mt-4 text-primary underline">View event details</Link>
        </li>
      )}</ul>}
    <Link href="/account" className="inline-block mt-10 text-primary underline">Back to your dashboard</Link>
  </main>
}
