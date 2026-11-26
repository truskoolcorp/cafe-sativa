'use client'

import { useEffect, useRef, useState } from 'react'
import type { GalleryVoiceLink, LiveVoiceConnection, VoiceState } from '@/lib/concierge/live-voice-client'

export default function LiveVoiceConversation({ host, galleryWork, conversationId, signedIn, onStart, onActive }: {
  host: string; galleryWork?:string|null; conversationId: string | null; signedIn: boolean
  onStart: () => void; onActive: (active: boolean) => void
}) {
  const [available, setAvailable] = useState(false)
  const [checked,setChecked]=useState(false)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<VoiceState>('idle')
  const [message, setMessage] = useState('')
  const [voiceLinks, setVoiceLinks] = useState<GalleryVoiceLink[]>([])
  const root = useRef<HTMLDivElement>(null)
  const connection = useRef<LiveVoiceConnection | null>(null)
  const pending = useRef<AbortController | null>(null)
  const activeCallback = useRef(onActive)
  activeCallback.current = onActive

  useEffect(() => {
    const abort = new AbortController()
    setAvailable(false); setChecked(false)
    const url='/api/concierge/livekit/session'+(host==='zaria'?'?host=zaria':'')
    fetch(url, { signal: abort.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(data => { if (!abort.signal.aborted) setAvailable(data?.available === true) }).catch(() => {}).finally(()=>{if(!abort.signal.aborted)setChecked(true)})
    return () => abort.abort()
  }, [host])
  useEffect(() => {
    let canceled = false
    setReady(false)
    setVoiceLinks([])
    if (available) void import('@/lib/concierge/live-voice-client').then(({ LiveVoiceConnection }) => {
      if (canceled) return
      connection.current = new LiveVoiceConnection((next, detail) => {
      setState(next); setMessage(detail || '')
      activeCallback.current(['connecting', 'waiting', 'connected', 'reconnecting'].includes(next))
      }, root.current!, undefined, host === 'zaria' ? links => { if (!canceled) setVoiceLinks(links) } : undefined)
      setReady(true)
    }).catch(() => { if (!canceled) { setState('error'); setMessage('Live conversation could not load. Refresh to try again.') } })
    return () => {
      canceled = true
      pending.current?.abort()
      connection.current?.stop()
      activeCallback.current(false)
    }
  }, [host, conversationId, available])

  async function start() {
    if (!signedIn || !conversationId || !connection.current || pending.current) return
    onStart()
    setState('connecting'); setMessage(''); onActive(true)
    const abort = new AbortController()
    pending.current = abort
    const timer = setTimeout(() => abort.abort(), 15000)
    try {
      const response = await fetch('/api/concierge/livekit/session', {
        method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, conversation_id: conversationId, ...(host==='zaria'&&galleryWork?{gallery_work:galleryWork}:{}) }),
      })
      const data = await response.json()
      if (abort.signal.aborted) return
      if (!response.ok || typeof data.server_url !== 'string' || typeof data.participant_token !== 'string') {
        throw new Error(response.ok ? 'Live conversation is unavailable.' : data.error || 'Could not start live conversation.')
      }
      await connection.current?.start(data.server_url, data.participant_token)
    } catch (error) {
      if (pending.current === abort) {
        setState('error'); setMessage(error instanceof Error && error.name !== 'AbortError' ? error.message : 'The connection timed out. Please try again.')
        onActive(false)
      }
    } finally { clearTimeout(timer); if (pending.current === abort) pending.current = null }
  }
  function stop() {
    pending.current?.abort(); pending.current = null
    connection.current?.stop(); setState('ended'); setMessage(host === 'zaria' ? 'You ended the live conversation. You can keep chatting by text.' : ''); onActive(false)
  }
  const active = ['connecting', 'waiting', 'connected', 'reconnecting'].includes(state)
  if(host==='zaria'&&checked&&!available)return <p role="status" className="py-3 text-sm text-muted-foreground">Live voice is not available. You can still chat with Zaria by text.</p>
  return <div className={available ? 'mt-4 rounded-lg border border-primary/40 p-4' : 'hidden'}>
    <div ref={root} />
    {available && <>
      <button type="button" className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50"
        disabled={!active && (!signedIn || !conversationId || !ready)} onClick={active ? stop : start}>
        {active ? 'End live conversation' : 'Start live conversation'}
      </button>
      <p className="mt-2 text-sm" role="status">
        {message || (!signedIn ? 'Sign in to talk live with this host.' : !conversationId ? 'Send a first message to this host, then start your live conversation.' :
          state === 'connecting' ? 'Connecting…' : state === 'waiting' ? 'Waiting for your host…' : state === 'reconnecting' ? 'Reconnecting…' :
          state === 'connected' ? 'Speak naturally. You can interrupt the host or end the call at any time.' : 'Voice conversations last up to five minutes. Your conversation is saved to your account.')}
      </p>
      {host === 'zaria' && state === 'connected' && voiceLinks.length > 0 &&
        <nav aria-label="Suggestions from Zaria’s live conversation" className="mt-3 flex flex-wrap gap-3 text-sm">
          {voiceLinks.map(link => <a key={link.path} href={link.path} className="text-primary underline underline-offset-4">{link.label}</a>)}
        </nav>}
    </>}
  </div>
}
