'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type EventRow = {
  id: string; slug: string; title: string; subtitle: string | null
  starts_at: string; ends_at: string | null
  status: 'draft' | 'scheduled' | 'live' | 'ended' | 'canceled'
  zoom_join_url: string | null; zoom_meeting_id: string | null
  presenter_name: string | null
  access: 'ticketed' | 'free' | 'tier_included' | 'purchase_required'
}

const C = {
  bg:'#0d0a07', surface:'#161008', card:'#1c1409', border:'#2e1f0e',
  accent:'#b8813a', green:'#4caf7d', amber:'#e0a030', red:'#c0504a',
  text:'#e8ddd0', textDim:'#9e8870', muted:'#6b5540',
}

export default function WatchPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug
  const [event, setEvent] = useState<EventRow | null>(null)
  const [hasTicket, setHasTicket] = useState<boolean | null>(null)
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeUntil, setTimeUntil] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    async function load() {
      try {
        const supabase = createClient()
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) { setIsSignedIn(false); setLoading(false); return }
        setIsSignedIn(true)
        const { data: ev, error: evErr } = await supabase
          .from('my_events_v')
          .select('id,slug,title,subtitle,starts_at,ends_at,status,zoom_join_url,zoom_meeting_id,presenter_name,access')
          .eq('slug', slug).maybeSingle()
        if (evErr || !ev) { setError('Event not found.'); setLoading(false); return }
        setEvent(ev as EventRow)
        const { data: ticket } = await supabase
          .from('tickets').select('id,state')
          .eq('event_id', ev.id).eq('user_id', userData.user.id).maybeSingle()
        setHasTicket(!!(ticket && ticket.state === 'valid') || ev.access === 'ticketed' || ev.access === 'tier_included')
      } catch { setError('Could not load event.') } finally { setLoading(false) }
    }
    load()
  }, [slug])

  useEffect(() => {
    if (!event || event.status !== 'scheduled') return
    const update = () => {
      const diff = new Date(event.starts_at).getTime() - Date.now()
      if (diff <= 0) { setTimeUntil('Starting now...'); return }
      const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000)
      setTimeUntil(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [event])

  const shell = (children: React.ReactNode) => (
    <div style={{ background:C.bg, minHeight:'100vh', fontFamily:"'Inter',sans-serif", color:C.text }}>
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:'0 24px', display:'flex', alignItems:'center', height:52, background:C.surface }}>
        <Link href={`/events/${slug}`} style={{ color:C.textDim, fontSize:12, textDecoration:'none' }}>← Back to event</Link>
        {event && <span style={{ marginLeft:'auto', fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:10, textTransform:'uppercase', letterSpacing:'0.08em', background:event.status==='live'?'#0a2010':event.status==='ended'?'#1a1410':'#2a1f00', color:event.status==='live'?C.green:event.status==='ended'?C.muted:C.amber }}>{event.status==='live'?'Live':event.status==='ended'?'Ended':`Starts in ${timeUntil||'...'}`}</span>}
      </div>
      <div style={{ maxWidth:860, margin:'0 auto', padding:'32px 24px' }}>{children}</div>
    </div>
  )

  if (loading) return shell(<div style={{ textAlign:'center', padding:60, color:C.muted }}>Loading...</div>)
  if (!isSignedIn) return shell(
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'48px 40px', maxWidth:400, margin:'40px auto', textAlign:'center' }}>
      <h2 style={{ margin:'0 0 12px', color:C.text, fontSize:20, fontWeight:700 }}>Sign in to join</h2>
      <p style={{ margin:'0 0 24px', color:C.textDim, fontSize:14 }}>You need an account to access this event.</p>
      <a href={`/auth/signin?redirect=/events/${slug}/watch`} style={{ display:'inline-block', background:C.accent, color:'#0d0a07', padding:'12px 28px', borderRadius:6, fontWeight:700, fontSize:14, textDecoration:'none' }}>Sign in</a>
    </div>
  )
  if (error || !event) return shell(<div style={{ textAlign:'center', padding:60 }}><p style={{ color:C.red }}>{error||'Event not found.'}</p><Link href="/events" style={{ color:C.accent }}>Back to events</Link></div>)
  if (!hasTicket) return shell(
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'48px 40px', maxWidth:400, margin:'40px auto', textAlign:'center' }}>
      <h2 style={{ margin:'0 0 12px', color:C.text, fontSize:20, fontWeight:700 }}>Ticket required</h2>
      <p style={{ margin:'0 0 24px', color:C.textDim, fontSize:14 }}>You do not have a ticket for {event.title}.</p>
      <Link href={`/events/${slug}`} style={{ display:'inline-block', background:C.accent, color:'#0d0a07', padding:'12px 28px', borderRadius:6, fontWeight:700, fontSize:14, textDecoration:'none' }}>Get a ticket</Link>
    </div>
  )

  const isLive = event.status === 'live'
  const isEnded = event.status === 'ended'

  return shell(
    <>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ margin:'0 0 6px', fontSize:26, fontWeight:700 }}>{event.title}</h1>
        {event.subtitle && <p style={{ margin:'0 0 4px', color:C.textDim, fontSize:15 }}>{event.subtitle}</p>}
        {event.presenter_name && <p style={{ margin:0, color:C.muted, fontSize:13 }}>with {event.presenter_name}</p>}
      </div>

      {isEnded ? (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'48px 40px', textAlign:'center', marginBottom:20 }}>
          <h2 style={{ margin:'0 0 12px', color:C.text, fontSize:20, fontWeight:700 }}>This event has ended</h2>
          <p style={{ margin:'0 0 24px', color:C.textDim, fontSize:14, lineHeight:1.6 }}>A recording may be available soon. Check back on The Stage for updates.</p>
          <Link href="/events" style={{ color:C.accent, fontSize:14 }}>Browse upcoming events</Link>
        </div>
      ) : !isLive ? (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'48px 40px', textAlign:'center', marginBottom:20 }}>
          <h2 style={{ margin:'0 0 12px', color:C.text, fontSize:20, fontWeight:700 }}>Starting in {timeUntil}</h2>
          <p style={{ margin:'0 0 28px', color:C.textDim, fontSize:14, lineHeight:1.6 }}>Your ticket is confirmed. This page updates automatically when we go live.</p>
          {event.zoom_join_url && (
            <a href={event.zoom_join_url} target="_blank" rel="noopener noreferrer"
              style={{ display:'inline-block', background:C.surface, border:`1px solid ${C.border}`, color:C.textDim, padding:'10px 20px', borderRadius:6, fontSize:13, textDecoration:'none' }}>
              Open in Zoom
            </a>
          )}
        </div>
      ) : event.zoom_join_url ? (
        <div style={{ marginBottom:20 }}>
          <div style={{ background:'#0a2010', border:`1px solid ${C.green}`, borderRadius:8, padding:'12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <span style={{ color:C.green, fontSize:13, fontWeight:600 }}>Live now - join the event</span>
            <a href={event.zoom_join_url} target="_blank" rel="noopener noreferrer"
              style={{ background:C.green, color:'#0d0a07', padding:'8px 20px', borderRadius:5, fontSize:13, fontWeight:700, textDecoration:'none' }}>Open in Zoom</a>
          </div>
          {event.zoom_meeting_id && (
            <div style={{ background:'#000', borderRadius:10, overflow:'hidden', border:`1px solid ${C.border}`, position:'relative', paddingTop:'56.25%' }}>
              <iframe
                src={`https://zoom.us/wc/${event.zoom_meeting_id}/join`}
                style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none' }}
                allow="camera; microphone; fullscreen; display-capture"
                allowFullScreen title={event.title}
              />
            </div>
          )}
          <p style={{ margin:'12px 0 0', color:C.muted, fontSize:12, textAlign:'center' }}>If the embed does not load, use Open in Zoom above.</p>
        </div>
      ) : (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'48px 40px', textAlign:'center', marginBottom:20 }}>
          <h2 style={{ margin:'0 0 12px', color:C.text, fontSize:20, fontWeight:700 }}>We are live - join link coming</h2>
          <p style={{ margin:0, color:C.textDim, fontSize:14 }}>Refresh in a moment.</p>
        </div>
      )}

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 20px', display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ color:C.green }}>Ticket confirmed</span>
        <span style={{ color:C.textDim, fontSize:13 }}> - <Link href={`/events/${slug}`} style={{ color:C.accent, textDecoration:'none' }}>Event details</Link></span>
      </div>
    </>
  )
}
