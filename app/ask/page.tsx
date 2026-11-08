'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import Image from 'next/image'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Send,
  Rose,
  Compass,
  Sparkles,
  AlertCircle,
  Info,
  Mic,
  Square,
  Volume2,
  VolumeX,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createChatStorage } from '@/lib/concierge/browser-session'
import { createPendingChatStorage, sameChatIdentity, chatRequestResolved, recoverChatRequest, type PendingChatRequest } from '@/lib/concierge/browser-requests'
import LiveVoiceConversation from '@/components/LiveVoiceConversation'

/**
 * When the server enables durable chat, keep one unresolved request per
 * account/guest and host. Persist before sending; uncertain outcomes require explicit
 * status recovery, never a fresh request ID or a silently edited payload.
 */

type HostId = 'laviche' | 'ginger' | 'ahnika'

type HostMeta = {
  id: HostId
  displayName: string
  role: string
  tagline: string
  /** Icon shown on the host card + message avatar. */
  icon: LucideIcon
  /** Optional circular photo avatar (card badge + chat header). */
  avatar?: string
  /** Inline suggestion copy — appears when the chat is empty. */
  suggestions: string[]
}

const HOSTS: HostMeta[] = [
  {
    id: 'laviche',
    displayName: 'Laviche',
    role: "Maître d'",
    tagline: 'Runs the floor and the looks. Concrete Rose is hers.',
    icon: Rose,
    avatar: '/api/hosts/portrait?host=laviche',
    suggestions: [
      'What\u2019s the vision for Café Sativa?',
      'How do I get into the cigar lounge?',
      'Show me something from Concrete Rose.',
    ],
  },
  {
    id: 'ginger',
    displayName: 'Ginger',
    role: 'Travel concierge',
    tagline: 'Adventure travel. Dallasite on Tour and Wanderlust are hers.',
    icon: Compass,
    avatar: '/api/hosts/portrait?host=ginger',
    suggestions: [
      'Tell me about Tenerife.',
      'Tell me about Wanderlust.',
      'What\u2019s Dallasite on Tour?',
    ],
  },
  {
    id: 'ahnika',
    displayName: 'Ahnika',
    role: 'Alignment + wellness',
    tagline: 'Alignment, movement, and feeling good in your body.',
    icon: Sparkles,
    avatar: '/api/hosts/portrait?host=ahnika',
    suggestions: [
      'How do I get back in alignment?',
      'Tell me about Faithfully Faded.',
      'Any tips to feel grounded before an event?',
    ],
  },
]

type Message = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// Lazy access keeps SSR safe; blocked storage falls back to page-local memory.
const pendingStorage = createPendingChatStorage(() => window.localStorage)
const chatStorage = createChatStorage(() => window.localStorage, () => crypto.randomUUID())

/**
 * Minimal typing for the Web Speech API (SpeechRecognition), which is
 * not part of the standard TS DOM lib. We only model the few fields we
 * touch. Browser support is Chrome/Edge/Safari; Firefox lacks it, so
 * the mic button is hidden when the constructor is absent.
 */
type SpeechResultLike = { 0: { transcript: string }; isFinal: boolean }
type SpeechEventLike = {
  resultIndex: number
  results: { length: number; [i: number]: SpeechResultLike }
}
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function AskInner() {
  const searchParams = useSearchParams()
  const hostParam = searchParams.get('host') as HostId | null
  const initialHost: HostId = HOSTS.some((h) => h.id === hostParam)
    ? (hostParam as HostId)
    : 'laviche'

  const [activeHost, setActiveHost] = useState<HostId>(initialHost)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [pending, setPending] = useState<PendingChatRequest | null>(null)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  const [durableEnabled, setDurableEnabled] = useState<boolean | null>(null)
  const chatBlocked = durableEnabled === null || storageBlocked || (durableEnabled && storageUnavailable)
  const pendingRef = useRef<PendingChatRequest | null>(null)
  const [liveActive, setLiveActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateLimited, setRateLimited] = useState<string | null>(null)
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  // Voice — layered on top of the text concierge, fully optional.
  const [portraitFailures,setPortraitFailures]=useState<Record<string,boolean>>({})
  const [voiceMode, setVoiceMode] = useState(false) // speak replies aloud
  const [voiceSupported, setVoiceSupported] = useState(true) // server TTS (flips off on 503)
  const [sttSupported, setSttSupported] = useState(false) // browser speech-to-text
  const [listening, setListening] = useState(false) // mic actively capturing
  const [speakingTs, setSpeakingTs] = useState<number | null>(null) // which reply is playing

  const sessionIdRef = useRef<string>('')
  const conversationIdRef = useRef<string | null>(null)
  const requesterRef = useRef('')
  const activeHostRef = useRef(activeHost)
  activeHostRef.current = activeHost
  const requestAbortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sendingRef = useRef(false)
  const voiceTurnRef = useRef(0)
  const mountedRef = useRef(true)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioDoneRef = useRef<(() => void) | null>(null)
  const sendRef = useRef<(text:string)=>Promise<void>>(async()=>{})
  const listenRef = useRef<()=>void>(()=>{})
  const voiceModeRef = useRef(false) // mirror of voiceMode for async sendMessage

  // Initialize session id + auth state on mount
  useEffect(() => {
    mountedRef.current = true
    sessionIdRef.current = chatStorage.sessionId()
    setSttSupported(getSpeechRecognition() !== null)
    const applyIdentity = (user: { id: string; email?: string } | null) => {
      if (!mountedRef.current) return
      const requester = user ? `user:${user.id}` : `guest:${sessionIdRef.current}`
      if (requesterRef.current !== requester) {
        if (requesterRef.current) setInput('')
        requesterRef.current = requester
        conversationIdRef.current = chatStorage.conversationId(activeHostRef.current, requester)
        voiceTurnRef.current++
        setMessages([])
        setError(null)
        setRateLimited(null)
        loadPending(activeHostRef.current, requester)
        stopListening()
        stopAudio()
      }
      setIsSignedIn(Boolean(user))
      setUserEmail(user?.email ?? null)
    }
    const supabase = createClient()
    let authRevision = 0
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authRevision++
      applyIdentity(session?.user ?? null)
    })
    const revision = authRevision
    supabase.auth.getUser().then(({ data, error }) => {
      if (revision !== authRevision || !mountedRef.current) return
      // Auth/network failures are not proof of an anonymous session.
      if (error && error.name !== 'AuthSessionMissingError') {
        setError('Your sign-in status could not be checked. Reload to try again before opening chat.')
        return
      }
      applyIdentity(data.user)
    }).catch((error: unknown) => {
      if (revision === authRevision && mountedRef.current) {
        if ((error as { name?: string })?.name === 'AuthSessionMissingError') {
          applyIdentity(null)
          return
        }
        setError('Your sign-in status could not be checked. Reload to try again before opening chat.')
      }
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Authoritative capability, never a public build-time flag. Failure stays closed.
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    let active = true
    void (async () => {
      try {
        const response = await fetch('/api/concierge/status', { method: 'GET', cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok || typeof data.durable_enabled !== 'boolean') throw new Error('Capability unavailable')
        if (active) setDurableEnabled(data.durable_enabled)
      } catch {
        if (active) setError('Chat availability could not be checked. Reload to try again; no message has been sent.')
      } finally { clearTimeout(timeout) }
    })()
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [])

  // Stop any audio / mic capture when the component unmounts
  useEffect(() => {
    return () => {
      mountedRef.current = false
      requestAbortRef.current?.abort()
      voiceModeRef.current = false
      voiceTurnRef.current++
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
      stopListening()
      stopAudio()
    }
  }, [])

  // Host change — clear chat view, load stored conversation id
  useEffect(() => {
    setMessages([])
    setError(null)
    setRateLimited(null)
    conversationIdRef.current = chatStorage.conversationId(activeHost, requesterRef.current)
    if (requesterRef.current) loadPending(activeHost, requesterRef.current)
    voiceTurnRef.current++
    stopListening()
    stopAudio()
    resumeListening()
  }, [activeHost])

  // Pin to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  function loadPending(host: HostId, requester: string) {
    try {
      const saved = pendingStorage.load(host, requester)
      pendingRef.current = saved
      setPending(saved)
      setStorageBlocked(false)
      setStorageUnavailable(false)
    } catch (error) {
      pendingRef.current = null
      setPending(null)
      const unavailable = (error as { code?: string }).code === 'storage_unavailable'
      setStorageUnavailable(unavailable)
      setStorageBlocked(!unavailable)
      if (!unavailable) setError('Retained chat data could not be read safely. Resolve it before sending another message.')
    }
  }

  async function sendMessage(text?: string) {
    const trimmed = (text ?? input).trim()
    if (!trimmed || sendingRef.current || liveActive || isSignedIn === null || pendingRef.current || chatBlocked) return
    const request: PendingChatRequest = {
      requester: requesterRef.current, host: activeHost,
      body: JSON.stringify({ ...(durableEnabled ? { request_id: crypto.randomUUID() } : {}), host: activeHost, message: trimmed,
        session_id: sessionIdRef.current, conversation_id: conversationIdRef.current, surface: 'web-chat' }),
    }
    if (durableEnabled) try {
      pendingStorage.save(request)
      pendingRef.current = request
      setPending(request)
    } catch {
      loadPending(activeHost, requesterRef.current)
      setError('Could not retain this message safely. Check browser storage before sending.')
      return
    }
    setInput('')
    const bubble: Message = { role: 'user', content: trimmed, timestamp: Date.now() }
    setMessages(previous => [...previous, bubble])
    await runRequest(request, false, durableEnabled === true, bubble)
  }

  async function recoverPending() {
    const request = pendingRef.current
    if (!request || sendingRef.current || liveActive || !sameChatIdentity(request.requester, requesterRef.current) || request.host !== activeHostRef.current) return
    await runRequest(request, true)
  }

  async function runRequest(request: PendingChatRequest, recovery: boolean, retained = true, bubble?: Message) {
    sendingRef.current = true
    setSending(true)
    const turn = voiceTurnRef.current
    const current = () => mountedRef.current && turn === voiceTurnRef.current
      && sameChatIdentity(request.requester, requesterRef.current) && activeHostRef.current === request.host
    const controller = new AbortController()
    requestAbortRef.current = controller
    const timeout = setTimeout(() => controller.abort(), 65000)
    let succeeded = false
    setError(null)
    setRateLimited(null)
    stopListening()
    stopAudio()
    try {
      let res: Response, data: Record<string, any>, lookup = recovery
      if (recovery) {
        const result = await recoverChatRequest(request, fetch, controller.signal, current)
        res = result.response; data = result.data; lookup = result.recovery
      } else {
        res = await fetch('/api/concierge', { signal: controller.signal, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Concierge-Durable': retained ? '1' : '0', 'X-Concierge-Requester': request.requester }, body: request.body })
        data = await res.json().catch(() => ({}))
      }
      if (!current()) return
      const resolved = !retained || chatRequestResolved(res.status, data, lookup)
      if (resolved && retained) {
        pendingStorage.clear(request)
        loadPending(request.host, requesterRef.current)
      }
      if (res.status === 200 && typeof data.message === 'string' && data.message.trim()) {
        if (data.conversation_id) {
          if (request.requester === requesterRef.current) conversationIdRef.current = data.conversation_id
          chatStorage.saveConversation(request.host, request.requester, data.conversation_id)
        }
        const reply = { role: 'assistant' as const, content: data.message, timestamp: Date.now() }
        setMessages(previous => [...previous, reply])
        if (data.memory_saved === false && typeof data.warning === 'string') setError(data.warning)
        succeeded = true
        if (voiceModeRef.current) await speak(data.message, request.host, reply.timestamp)
      } else if (data.code === 'durable_disabled') {
        setError('Recovery is unavailable while durable chat is disabled. The original message may have completed. It is retained and will not be resent; enable recovery or contact support to resolve it.')
      } else if (!resolved) {
        setError(data.code === 'save_pending'
          ? 'The reply is awaiting safe storage. Check the original message again shortly.'
          : 'This message is unresolved and may still be processing. Check the original message before starting another.')
      } else {
        if (res.status === 403 && data.code === 'conversation_unavailable') {
          conversationIdRef.current = null
          chatStorage.clearConversation(request.host, request.requester)
          setError('That conversation has ended or belongs to another session. Send your message again to start a new conversation.')
        } else if (res.status === 429 && data.rate_limited) setRateLimited(data.error || 'You have hit the message limit.')
        else if (data.code === 'mode_changed') setError('Chat mode changed. Reload this page before sending again; this message was not admitted.')
        else setError(data.error || 'This request ended without a reply.')
        setInput(JSON.parse(request.body).message)
      }
    } catch (err) {
      if (!current()) return
      console.error('[ask] send failed', err)
      setError(!retained
        ? (controller.signal.aborted ? 'The reply took too long. It may still have been processed; check before sending again.' : 'The reply could not be received. Check your connection before sending again.')
        : controller.signal.aborted
        ? 'The reply took too long. It may still have been processed. Check the original message to recover it safely.'
        : 'The reply could not be confirmed. Your original message is retained; check it before sending another.')
    } finally {
      clearTimeout(timeout)
      if (requestAbortRef.current === controller) requestAbortRef.current = null
      if (!retained && !succeeded && current()) {
        setInput(value => value || JSON.parse(request.body).message)
        setMessages(previous => previous.filter(message => message !== bubble))
      }
      sendingRef.current = false
      if (mountedRef.current) setSending(false)
      if (current() && succeeded) resumeListening()
      else if (current() && voiceModeRef.current) {
        voiceModeRef.current = false
        setVoiceMode(false)
      }
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function stopListening() {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = null
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) { rec.onend = null; rec.onresult = null; rec.onerror = null; rec.stop() }
    if (mountedRef.current) setListening(false)
  }
  function stopAudio() {
    audioRef.current?.pause()
    audioDoneRef.current?.()
    audioDoneRef.current = null
    audioRef.current = null
    if (mountedRef.current) setSpeakingTs(null)
  }
  function resumeListening() {
    if (!voiceModeRef.current || !mountedRef.current) return
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null
      if (voiceModeRef.current && !sendingRef.current && !audioRef.current && mountedRef.current) listenRef.current()
    }, 350)
  }

  // Resolve only when playback finishes, so the microphone never transcribes the host.
  async function speak(text: string, host: HostId, ts: number) {
    if (!voiceSupported || !text.trim()) return
    const turn = voiceTurnRef.current
    const conversational = voiceModeRef.current
    stopListening()
    stopAudio()
    try {
      const res = await fetch('/api/concierge/speak', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, text }),
      })
      if (!mountedRef.current || turn !== voiceTurnRef.current || (conversational && !voiceModeRef.current)) return
      if (!res.ok) throw new Error(res.status === 503 ? 'Voice is temporarily unavailable.' : 'Could not play the host voice. Try again.')
      const blob = await res.blob()
      if (!mountedRef.current || turn !== voiceTurnRef.current || (conversational && !voiceModeRef.current)) return
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      setSpeakingTs(ts)
      await new Promise<void>((resolve, reject) => {
        let ended = false
        const cleanup = () => {
          if (ended) return
          ended = true
          URL.revokeObjectURL(url)
          if (audioRef.current === audio) audioRef.current = null
          audioDoneRef.current = null
          if (mountedRef.current) setSpeakingTs(cur => cur === ts ? null : cur)
        }
        audioDoneRef.current = () => { cleanup(); resolve() }
        audio.onended = () => { cleanup(); resolve() }
        audio.onerror = () => { cleanup(); reject(new Error('Audio playback failed.')) }
        audio.play().catch(() => { cleanup(); reject(new Error('Your browser blocked audio. Click the speaker button to play the reply, then enable voice mode again.')) })
      })
      if (!sendingRef.current) resumeListening()
    } catch (e) {
      if (mountedRef.current && turn === voiceTurnRef.current) {
        setError(e instanceof Error ? e.message : 'Voice playback failed.')
        voiceModeRef.current = false
        setVoiceMode(false)
      }
    }
  }

  function startListening() {
    const Ctor = getSpeechRecognition()
    if (!Ctor || pendingRef.current || chatBlocked || recognitionRef.current || sendingRef.current || audioRef.current) return
    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = false
    rec.interimResults = true
    let finalText = ''
    let failed = false
    rec.onresult = e => {
      let interim = ''
      finalText = ''
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) finalText += result[0].transcript + ' '
        else interim += result[0].transcript + ' '
      }
      setInput((finalText + interim).trim())
    }
    rec.onend = () => {
      if (recognitionRef.current !== rec) return
      recognitionRef.current = null
      setListening(false)
      if (voiceModeRef.current && !failed) {
        if (finalText.trim()) void sendRef.current(finalText.trim())
        else resumeListening()
      }
    }
    rec.onerror = event => {
      if (event.error === 'no-speech') return
      failed = true
      recognitionRef.current = null
      setListening(false)
      voiceModeRef.current = false
      setVoiceMode(false)
      setError(event.error === 'not-allowed' ? 'Allow microphone access, then enable voice mode again.' : 'Microphone stopped. Enable voice mode to try again.')
    }
    recognitionRef.current = rec
    setListening(true)
    try { rec.start() } catch {
      recognitionRef.current = null
      setListening(false)
      voiceModeRef.current = false
      setVoiceMode(false)
      setError('Could not start the microphone. Try enabling voice mode again.')
    }
  }
  listenRef.current = startListening
  sendRef.current = sendMessage

  function toggleMic() {
    if (recognitionRef.current) {
      // In voice mode, stopping the microphone explicitly pauses the conversation.
      if (voiceModeRef.current) { voiceModeRef.current = false; setVoiceMode(false); stopListening() }
      else recognitionRef.current.stop()
    } else startListening()
  }
  function toggleVoiceMode() {
    const next = !voiceModeRef.current
    voiceModeRef.current = next
    setVoiceMode(next)
    setError(null)
    if (!next) {
      stopListening()
      stopAudio()
    } else {
      if (getSpeechRecognition()) startListening()
      else setError('This browser supports spoken replies, but hands-free microphone input is unavailable. Try Chrome.')
    }
  }

  const activeHostMeta = HOSTS.find((h) => h.id === activeHost)!
  const ActiveHostIcon = activeHostMeta.icon

  const hostMark = (size: 'sm' | 'md') => {
    if (activeHostMeta.avatar && !portraitFailures[activeHost]) {
      return (
        <span
          className={cn(
            'inline-flex rounded-full overflow-hidden border border-primary/40 shrink-0',
            size === 'md' ? 'w-6 h-6' : 'w-4 h-4'
          )}
        >
          <Image
            src={activeHostMeta.avatar}
            onError={()=>setPortraitFailures(previous=>({...previous,[activeHost]:true}))}
            unoptimized
            alt=""
            width={24}
            height={24}
            className="w-full h-full object-cover"
          />
        </span>
      )
    }
    return (
      <ActiveHostIcon
        className={cn(size === 'md' ? 'w-5 h-5' : 'w-3 h-3', 'text-primary')}
      />
    )
  }

  return (
    <div className="pt-24 pb-12 bg-background min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page header */}
        <div className="mb-8">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Ask the house
          </p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
            Talk to one of the hosts.
          </h1>
          <p className="text-base md:text-lg text-muted-foreground font-body mt-4 max-w-2xl leading-relaxed">
            Ask about events, membership, travel, merch. Our three hosts each
            cover a different part of the house — pick whoever fits your
            question.
          </p>
        </div>

        {/* Host selector — three cards, icon + name + role + tagline */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {HOSTS.map((h) => {
            const active = h.id === activeHost
            const HostIcon = h.icon
            return (
              <button
                key={h.id}
                onClick={() => setActiveHost(h.id)}
                className={cn(
                  'group relative rounded-xl border p-4 text-left transition-all',
                  active
                    ? 'border-primary bg-card'
                    : 'border-border bg-card/50 hover:border-primary/40 hover:bg-card'
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'w-9 h-9 rounded-full overflow-hidden flex items-center justify-center shrink-0 border',
                      h.avatar
                        ? active
                          ? 'border-primary/70'
                          : 'border-primary/30'
                        : active
                          ? 'bg-primary/10 border-primary/40'
                          : 'bg-muted border-border'
                    )}
                  >
                    {h.avatar && !portraitFailures[h.id] ? (
                      <Image
                        src={h.avatar}
                        onError={()=>setPortraitFailures(previous=>({...previous,[h.id]:true}))}
                        unoptimized
                        alt=""
                        width={36}
                        height={36}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <HostIcon
                        className={cn(
                          'w-4 h-4',
                          active ? 'text-primary' : 'text-muted-foreground'
                        )}
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'font-heading font-bold',
                          active ? 'text-foreground' : 'text-foreground/90'
                        )}
                      >
                        {h.displayName}
                      </span>
                      <span className="text-xs text-muted-foreground font-body">
                        {h.role}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-body mt-1 line-clamp-2">
                      {h.tagline}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Chat surface */}
        <div className="flex flex-col rounded-xl border border-border bg-card min-h-[520px]">
          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto p-6 lg:p-8">
            {messages.length === 0 && !sending && (
              <div className="py-8">
                <div className="flex items-center justify-center gap-2 text-muted-foreground mb-4">
                  {hostMark('md')}
                  <p className="text-sm font-body">
                    Start a conversation with {activeHostMeta.displayName}.
                  </p>
                </div>

                {/* Suggestion chips */}
                <div className="max-w-xl mx-auto space-y-2">
                  <p className="text-xs tracking-widest uppercase text-muted-foreground font-body text-center mb-3">
                    Try asking
                  </p>
                  {activeHostMeta.suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      disabled={isSignedIn === null || sending || !!pending || chatBlocked || liveActive}
                      className="group w-full rounded-lg border border-border bg-background/50 px-4 py-2.5 text-left text-sm text-foreground font-body hover:border-primary/40 hover:bg-background transition-colors disabled:opacity-50"
                    >
                      <span className="text-muted-foreground mr-2">“</span>
                      {s}
                      <span className="text-muted-foreground ml-1">”</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === 'user'
              return (
                <div
                  key={i}
                  className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 font-body',
                      isUser
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background border border-border text-foreground'
                    )}
                  >
                    {!isUser && (
                      <div className="mb-1.5 flex items-center gap-1.5">
                        {hostMark('sm')}
                        <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                          {activeHostMeta.displayName}
                        </p>
                        {voiceSupported && (
                          <button
                            type="button"
                            disabled={liveActive || !!pending || chatBlocked}
                            onClick={() => speak(m.content, activeHost, m.timestamp)}
                            aria-label={`Play ${activeHostMeta.displayName}'s reply`}
                            className="ml-0.5 text-muted-foreground hover:text-primary transition-colors"
                          >
                            {speakingTs === m.timestamp ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Volume2 className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              )
            })}

            {sending && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-background border border-border px-4 py-3">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    {hostMark('sm')}
                    <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                      {activeHostMeta.displayName}
                    </p>
                  </div>
                  <div className="flex gap-1.5 py-1.5">
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: '300ms' }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Rate-limit banner */}
          {rateLimited && (
            <div className="mx-6 mb-4 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-foreground font-body">
                  {rateLimited}
                  {!isSignedIn && (
                    <>
                      {' '}
                      <Link
                        href="/auth/signup"
                        className="text-primary underline hover:no-underline font-semibold"
                      >
                        Sign up free
                      </Link>{' '}
                      for a larger allowance.
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          {pending && (
            <div className="mx-6 mb-4 rounded-lg border border-primary/40 p-4" role="status">
              <p className="text-sm">An original message is retained for {activeHostMeta.displayName}:</p>
              <p className="text-sm whitespace-pre-wrap my-2">{JSON.parse(pending.body).message}</p>
              <p className="text-xs mb-3">New messages are paused until retained messages are resolved, one at a time. Recovery always uses the original text, session, and request ID.</p>
              <Button onClick={recoverPending} disabled={sending || liveActive}>Check original message</Button>
            </div>
          )}

          {durableEnabled === true && storageUnavailable && (
            <p className="mx-6 mb-4 text-sm" role="alert">Chat recovery storage is unavailable. Enable browser storage before sending.</p>
          )}

          {/* Error banner */}
          {error && (
            <div className="mx-6 mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-foreground font-body">{error}</p>
              </div>
            </div>
          )}

          <div className="px-4 lg:px-6">
            {!pending && !chatBlocked && <LiveVoiceConversation key={activeHost} host={activeHost} conversationId={conversationIdRef.current}
              signedIn={Boolean(isSignedIn)} onActive={setLiveActive}
              onStart={() => { voiceModeRef.current = false; setVoiceMode(false); stopListening(); stopAudio() }} />}
          </div>

          {/* Composer */}
          <div className="border-t border-border p-4 lg:p-6">
            <div className="flex items-end gap-3">
              {sttSupported && (
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={liveActive || !!pending || chatBlocked}
                  aria-label={listening ? 'Stop voice input' : 'Speak your message'}
                  className={cn(
                    'shrink-0 h-12 w-12 rounded-lg border flex items-center justify-center transition-colors',
                    listening
                      ? 'border-primary bg-primary/15 text-primary animate-pulse'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40'
                  )}
                >
                  {listening ? (
                    <Square className="w-4 h-4" />
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                </button>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={`Message ${activeHostMeta.displayName}…`}
                rows={1}
                disabled={isSignedIn === null || sending || !!pending || chatBlocked || liveActive}
                className="flex-1 resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm font-body text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 disabled:opacity-60"
                style={{ minHeight: '48px', maxHeight: '160px' }}
                onInput={(e) => {
                  // Auto-grow up to max-height
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
                }}
              />
              <Button
                onClick={() => sendMessage()}
                disabled={isSignedIn === null || sending || !!pending || chatBlocked || liveActive || !input.trim()}
                size="lg"
                className="shrink-0"
              >
                {sending ? (
                  'Sending…'
                ) : (
                  <>
                    Send
                    <Send className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground font-body">
                {isSignedIn
                  ? `Signed in as ${userEmail}. ${activeHostMeta.displayName} remembers returning guests.`
                  : 'Anonymous chat. Sign in for a larger message allowance and personalized continuity.'}
              </p>
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoiceMode}
                  disabled={liveActive || !!pending || chatBlocked}
                  aria-pressed={voiceMode}
                  className={cn(
                    'shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-body transition-colors',
                    voiceMode
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                  )}
                >
                  {voiceMode ? (
                    <Volume2 className="w-3.5 h-3.5" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5" />
                  )}
                  {voiceMode ? listening ? 'Listening…' : sending ? 'Host replying…' : speakingTs ? 'Speaking…' : 'Voice on' : 'Start voice conversation'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AskSkeleton() {
  return (
    <div className="pt-24 pb-12 bg-background min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="space-y-3">
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          <div className="h-12 max-w-lg bg-muted rounded animate-pulse" />
          <div className="h-5 w-3/4 bg-muted/50 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 rounded-xl border border-border bg-card/50 animate-pulse"
            />
          ))}
        </div>
        <div className="h-[520px] rounded-xl border border-border bg-card/50 animate-pulse" />
      </div>
    </div>
  )
}

export default function AskPage() {
  return (
    <Suspense fallback={<AskSkeleton />}>
      <AskInner />
    </Suspense>
  )
}
