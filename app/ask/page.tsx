'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type HostId = 'laviche' | 'ginger' | 'ahnika'

type HostMeta = {
  id: HostId
  display_name: string
  role: string
  tagline: string
}

const HOSTS: HostMeta[] = [
  {
    id: 'laviche',
    display_name: 'Laviche',
    role: "Maître d'",
    tagline: 'Runs the floor. Knows where everything is.',
  },
  {
    id: 'ginger',
    display_name: 'Ginger',
    role: 'Travel concierge',
    tagline: "Adventure travel. Tenerife's her thing.",
  },
  {
    id: 'ahnika',
    display_name: 'Ahnika',
    role: 'Style + merch',
    tagline: 'Alignment coach meets stylist.',
  },
]

type Message = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * Local-storage keys. Client-side state that persists across page
 * reloads. session_id for anonymous users; conversation_id for
 * multi-turn continuity with a specific host.
 */
const SESSION_KEY = 'cafe-sativa:session-id'
const CONV_KEY_PREFIX = 'cafe-sativa:conv-id:'

function ensureSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, id)
  }
  return id
}

function getStoredConversationId(hostId: HostId): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(CONV_KEY_PREFIX + hostId)
}

function setStoredConversationId(hostId: HostId, id: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(CONV_KEY_PREFIX + hostId, id)
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
  const [error, setError] = useState<string | null>(null)
  const [rateLimited, setRateLimited] = useState<string | null>(null)
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  const sessionIdRef = useRef<string>('')
  const conversationIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // Initialize session id + auth state on mount
  useEffect(() => {
    sessionIdRef.current = ensureSessionId()
    conversationIdRef.current = getStoredConversationId(activeHost)

    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setIsSignedIn(Boolean(data.user))
      setUserEmail(data.user?.email ?? null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When active host changes, clear the chat view and load the stored
  // conversation id for that host (if any). The server-side history
  // will be re-hydrated on the first new message via prior-memory
  // retrieval — we don't pre-fetch it because most visits start fresh.
  useEffect(() => {
    setMessages([])
    setError(null)
    setRateLimited(null)
    conversationIdRef.current = getStoredConversationId(activeHost)
  }, [activeHost])

  // Keep the view pinned to the newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function sendMessage() {
    const trimmed = input.trim()
    if (!trimmed || sending) return
    setError(null)
    setRateLimited(null)

    const userMsg: Message = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setSending(true)

    try {
      const res = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: activeHost,
          message: trimmed,
          session_id: sessionIdRef.current,
          conversation_id: conversationIdRef.current,
          surface: 'web-chat',
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 429 && data?.rate_limited) {
        setRateLimited(data.error || 'You have hit the message limit.')
        setSending(false)
        return
      }

      if (res.status === 503 && data?.code === 'not_configured') {
        setError(
          "The concierge is offline right now. Try again in a bit — we're sorting it out."
        )
        setSending(false)
        return
      }

      if (!res.ok) {
        setError(data?.error || 'Could not send your message.')
        setSending(false)
        return
      }

      if (data.conversation_id) {
        conversationIdRef.current = data.conversation_id
        setStoredConversationId(activeHost, data.conversation_id)
      }

      const replyMsg: Message = {
        role: 'assistant',
        content: data.message,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, replyMsg])
    } catch (err) {
      console.error('[ask] send failed', err)
      setError('Could not send your message. Check your connection.')
    } finally {
      setSending(false)
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send, Shift+Enter for newline (standard chat UX)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const activeHostMeta = HOSTS.find((h) => h.id === activeHost)!

  return (
    <main className="min-h-screen bg-[#2a0802] text-[#f7e7cf]">
      <header className="sticky top-0 z-30 border-b border-[#8a5a2b]/35 bg-[#2a0802]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" className="text-[1.75rem] font-semibold tracking-tight text-[#d2a24c]">
            Café Sativa
          </Link>
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/events" className="rounded-md px-3 py-2 text-[#f7e7cf] hover:bg-white/5">
              Events
            </Link>
            <Link
              href="/membership"
              className="rounded-md px-3 py-2 text-[#f7e7cf] hover:bg-white/5"
            >
              Membership
            </Link>
            {isSignedIn ? (
              <Link
                href="/account"
                className="rounded-md px-3 py-2 text-[#f7e7cf] hover:bg-white/5"
              >
                Account
              </Link>
            ) : (
              <Link
                href="/auth/signin?redirect=/ask"
                className="rounded-md px-3 py-2 text-[#f7e7cf] hover:bg-white/5"
              >
                Sign In
              </Link>
            )}
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-8 lg:px-10">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.35em] text-[#c9a961]">Ask the house</p>
          <h1 className="mt-3 text-4xl font-semibold text-[#d2a24c] md:text-5xl">
            Talk to one of the hosts.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[#eadbc7]">
            Ask about events, membership, travel, merch. Our three hosts each
            cover a different part of the house — pick whoever fits your question.
          </p>
        </div>

        {/* Host tabs */}
        <div className="mb-6 flex flex-wrap gap-3">
          {HOSTS.map((h) => {
            const active = h.id === activeHost
            return (
              <button
                key={h.id}
                onClick={() => setActiveHost(h.id)}
                className={
                  'rounded-2xl border px-5 py-3 text-left transition ' +
                  (active
                    ? 'border-[#d2a24c] bg-[#241008] text-[#d2a24c]'
                    : 'border-[#8a5a2b]/35 bg-[#1f0703] text-[#eadbc7] hover:border-[#d2a24c]/45')
                }
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">{h.display_name}</span>
                  <span className="text-xs text-[#eadbc7]/70">{h.role}</span>
                </div>
                <p className="mt-1 text-xs text-[#eadbc7]/80">{h.tagline}</p>
              </button>
            )
          })}
        </div>

        {/* Chat surface */}
        <div className="flex min-h-[440px] flex-col rounded-3xl border border-[#8a5a2b]/35 bg-[#1f0703]">
          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto p-6 lg:p-8">
            {messages.length === 0 && !sending && (
              <div className="py-8 text-center text-[#eadbc7]/70">
                <p className="text-sm">
                  Start a conversation with {activeHostMeta.display_name}.
                </p>
                <p className="mt-2 text-xs text-[#eadbc7]/50">
                  {activeHost === 'laviche' &&
                    'Try: "What\u2019s coming up this summer?" or "How do I get into the cigar lounge?"'}
                  {activeHost === 'ginger' &&
                    'Try: "Tell me about Tenerife." or "What should I know before visiting the Canaries?"'}
                  {activeHost === 'ahnika' &&
                    'Try: "What should I wear to Ep 1?" or "Show me something from Concrete Rose."'}
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={
                    'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ' +
                    (m.role === 'user'
                      ? 'bg-[#d2a24c] text-[#2a0802]'
                      : 'bg-[#2b1810] text-[#f7e7cf]')
                  }
                >
                  {m.role === 'assistant' && (
                    <p className="mb-1 text-xs uppercase tracking-wider text-[#c9a961]">
                      {activeHostMeta.display_name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-[#2b1810] px-4 py-3">
                  <p className="mb-1 text-xs uppercase tracking-wider text-[#c9a961]">
                    {activeHostMeta.display_name}
                  </p>
                  <div className="flex gap-1.5 py-2">
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-[#c9a961]"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-[#c9a961]"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-[#c9a961]"
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
            <div className="mx-6 mb-4 rounded-xl border border-[#c9a961]/30 bg-[#2b1810] px-4 py-3 text-sm text-[#eadbc7]">
              {rateLimited}
              {!isSignedIn && (
                <>
                  {' '}
                  <Link href="/auth/signup" className="text-[#d2a24c] underline">
                    Sign up free
                  </Link>{' '}
                  for a larger allowance.
                </>
              )}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mx-6 mb-4 rounded-xl bg-red-900/70 px-4 py-3 text-sm text-white">
              {error}
            </div>
          )}

          {/* Composer */}
          <div className="border-t border-[#8a5a2b]/35 p-4 lg:p-6">
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={`Message ${activeHostMeta.display_name}…`}
                rows={1}
                disabled={sending}
                className="flex-1 resize-none rounded-xl border border-[#8a5a2b]/40 bg-[#2b1810] px-4 py-3 text-sm text-[#f7e7cf] placeholder:text-[#eadbc7]/40 focus:border-[#d2a24c] focus:outline-none disabled:opacity-60"
                style={{ minHeight: '48px', maxHeight: '160px' }}
                onInput={(e) => {
                  // Auto-grow up to max-height
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={sending || !input.trim()}
                className="rounded-xl bg-[#d2a24c] px-5 py-3 text-sm font-semibold text-[#2a0802] transition hover:bg-[#e0b866] disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>

            <p className="mt-3 text-xs text-[#eadbc7]/50">
              {isSignedIn
                ? `Signed in as ${userEmail}. ${activeHostMeta.display_name} remembers returning guests.`
                : 'Anonymous chat. Sign in for a larger message allowance and personalized continuity.'}
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}

function AskSkeleton() {
  return (
    <main className="min-h-screen bg-[#2a0802]">
      <div className="mx-auto max-w-5xl px-6 py-8 lg:px-10">
        <div className="h-4 w-32 bg-[#c9a961]/30 rounded animate-pulse" />
        <div className="mt-6 h-12 max-w-lg bg-[#d2a24c]/20 rounded animate-pulse" />
        <div className="mt-10 h-96 bg-[#1f0703] rounded-3xl animate-pulse" />
      </div>
    </main>
  )
}

export default function AskPage() {
  return (
    <Suspense fallback={<AskSkeleton />}>
      <AskInner />
    </Suspense>
  )
}
