'use client'

import { useEffect, useRef, useState } from 'react'
import type { LiveVoiceConnection, VoiceState } from '@/lib/concierge/live-voice-client'

export default function LiveVoiceConversation({ host, conversationId, signedIn, onStart, onActive }: {
  host: string; conversationId: string | null; signedIn: boolean
  onStart: () => void; onActive: (active: boolean) => void
}) {
  const [available, setAvailable] = useState(false)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<VoiceState>('idle')
  const [message, setMessage] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const connection = useRef<LiveVoiceConnection | null>(null)
  const pending = useRef<AbortController | null>(null)
  const activeCallback = useRef(onActive)
  activeCallback.current = onActive

  useEffect(() => {
    const abort = new AbortController()
    fetch('/api/concierge/livekit/session', { signal: abort.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(data => { if (!abort.signal.aborted) setAvailable(data?.available === true) }).catch(() => {})
    return () => abort.abort()
  }, [])
  useEffect(() => {
    let canceled = false
    setReady(false)
    if (available) void import('@/lib/concierge/live-voice-client').then(({ LiveVoiceConnection }) => {
      if (canceled) return
      connection.current = new LiveVoiceConnection((next, detail) => {
      setState(next); setMessage(detail || '')
      activeCallback.current(['connecting', 'waiting', 'connected', 'reconnecting'].includes(next))
      }, root.current!)
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
        body: JSON.stringify({ host, conversation_id: conversationId }),
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
    connection.current?.stop(); setState('ended'); setMessage(''); onActive(false)
  }
  const active = ['connecting', 'waiting', 'connected', 'reconnecting'].includes(state)
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
    </>}
  </div>
}
