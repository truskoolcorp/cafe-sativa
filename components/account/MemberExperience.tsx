'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

/** Approved Café Sativa virtual venue features. Deliberately no invented
 * balances, referrals, sessions, replay assets, or entitlements. */
const sections = [
  { title: 'Past recordings', description: 'Rewatch approved Stage and venue sessions when released. VIP replay access will be checked against your membership.', href: '/stage', action: 'Explore the Stage' },
  { title: 'Recipe library', description: 'Class recipes and downloadable cards will appear after chef and content approval.', href: '/kitchen', action: 'Explore the Kitchen' },
  { title: 'Listening and recommendations', description: 'Curated episodes and trusted resources will appear when their links are reviewed and published.', href: '/discover', action: 'Explore approved content' },
  { title: 'Rewards and milestones', description: 'Points, referrals and redeemable perks are being prepared. No demo balances or rewards are shown as earned.', href: '/membership', action: 'See membership benefits' },
] as const

type UpcomingEvent = { id:string; slug:string; title:string; starts_at:string; access:string; category:string|null }

function UpcomingExperiences() {
  const [events,setEvents]=useState<UpcomingEvent[]>([])
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading')
  useEffect(()=>{
    let active=true
    async function refresh(){
      const db=createClient()
      const {data,error}=await db.from('my_events_v').select('id,slug,title,starts_at,access,category').gte('starts_at',new Date().toISOString()).order('starts_at',{ascending:true}).limit(6)
      if(!active)return
      if(error){setState('error');return}
      setEvents((data||[]) as UpcomingEvent[])
      setState('ready')
    }
    void refresh()
    return ()=>{active=false}
  },[])
  const accessLabel=(access:string)=>access==='ticketed'?'Ticket access':access==='tier_included'?'Included with membership':access==='free'?'Free access':'Ticket required'
  return <section aria-labelledby="upcoming-experiences" className="rounded-xl border border-border bg-card/50 p-5">
    <h3 id="upcoming-experiences" className="font-heading text-xl font-bold">Upcoming experiences</h3>
    <p className="mt-2 text-sm text-muted-foreground">Live event availability and access for your signed-in account. Access labels are not booking confirmations.</p>
    {state==='loading' && <p className="mt-4 text-sm text-muted-foreground" role="status">Checking the schedule…</p>}
    {state==='error' && <p className="mt-4 text-sm text-muted-foreground" role="status">The schedule is temporarily unavailable. Your membership and bookings have not changed.</p>}
    {state==='ready' && events.length===0 && <p className="mt-4 text-sm text-muted-foreground">No confirmed upcoming events are listed yet. Check back for new programming.</p>}
    {state==='ready' && events.length>0 && <ul className="mt-4 divide-y divide-border">{events.map(event=><li key={event.id} className="py-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{event.title}</p><p className="text-xs text-muted-foreground">{new Date(event.starts_at).toLocaleString('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short'})} CT · {accessLabel(event.access)}</p></div><Link className="text-sm text-primary underline-offset-4 hover:underline" href={`/events?category=${encodeURIComponent(event.category||'all')}`}>View events →</Link></li>)}</ul>}
  </section>
}

type MemberTicket = { id:string; event_id:string; state:string; created_at:string; amount_paid_cents:number|null }
function TicketHistory() {
  const [rows,setRows]=useState<MemberTicket[]>([])
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading')
  useEffect(()=>{
    let active=true
    async function load(){
      const db=createClient()
      const user=await db.auth.getUser()
      if(!active)return
      if(!user.data.user){setState('error');return}
      const {data,error}=await db.from('tickets').select('id,event_id,state,created_at,amount_paid_cents').eq('user_id',user.data.user.id).order('created_at',{ascending:false}).limit(20)
      if(!active)return
      if(error){setState('error');return}
      setRows((data||[]) as MemberTicket[])
      setState('ready')
    }
    void load()
    return ()=>{active=false}
  },[])
  return <section aria-labelledby="ticket-history" className="rounded-xl border border-border bg-card/50 p-5">
    <h3 id="ticket-history" className="font-heading text-xl font-bold">Your tickets and booking history</h3>
    <p className="mt-2 text-sm text-muted-foreground">Tickets issued to your signed-in account. A checkout reservation is not a confirmed ticket.</p>
    {state==='loading' && <p className="mt-4 text-sm text-muted-foreground" role="status">Checking your tickets…</p>}
    {state==='error' && <p className="mt-4 text-sm text-muted-foreground" role="status">Ticket history could not be loaded. No booking or payment was changed.</p>}
    {state==='ready' && rows.length===0 && <p className="mt-4 text-sm text-muted-foreground">No issued tickets found for this account.</p>}
    {state==='ready' && rows.length>0 && <ul className="mt-4 divide-y divide-border">{rows.map(ticket=><li className="py-3" key={ticket.id}><p className="text-sm font-semibold">Ticket · {ticket.state.replaceAll('_',' ')}</p><p className="text-xs text-muted-foreground">{new Date(ticket.created_at).toLocaleDateString('en-US',{timeZone:'America/Chicago',dateStyle:'medium'})} · Event reference: {ticket.event_id.slice(0,8)}…</p></li>)}</ul>}
  </section>
}

export function MemberExperience() {
  return (
    <section aria-labelledby="member-experience" className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Your Café Sativa</p>
        <h2 id="member-experience" className="font-heading text-2xl font-bold mt-2">Member experiences</h2>
        <p className="text-sm text-muted-foreground mt-2">Explore the venue while these member libraries are prepared. Only verified, approved content will be listed when available.</p>
      </div>
      <UpcomingExperiences />
      <TicketHistory />
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map(section => (
          <article key={section.title} className="rounded-xl border border-border bg-card/50 p-5">
            <h3 className="font-heading text-lg font-bold">{section.title}</h3>
            <p className="text-sm text-muted-foreground my-3">{section.description}</p>
            <Link className="text-sm font-semibold text-primary underline-offset-4 hover:underline" href={section.href}>{section.action} →</Link>
          </article>
        ))}
      </div>
    </section>
  )
}
