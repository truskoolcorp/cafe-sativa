'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Send,
  Rose,
  Compass,
  Sparkles,
  AlertCircle,
  Info,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * /ask — visitor-facing chat with the Café Sativa AI hosts.
 *
 * This is the most-touched logic surface on the whole site so the
 * restyle is visual-only. Everything behavioral is copied verbatim
 * from the pre-restyle version:
 *
 *   - Three hosts (Laviche maître d', Ginger travel, Ahnika style)
 *     selectable via tab bar or ?host=<id> URL param
 *   - Anonymous session id lives in localStorage (matches the mall
 *     key pattern) so rate-limit buckets and conversation memory
 *     work across reloads even without auth
 *   - Per-host conversation id also in localStorage (separate key
 *     per host) so switching hosts doesn't mash memory together
 *   - POST to /api/concierge with surface='web-chat'; handles 429
 *     (rate_limited), 503 (not_configured), 200 (normal reply)
 *   - Enter to send, Shift+Enter for newline, auto-grow textarea
 *     capped at 160px height
 *   - Scroll pin to bottom on new message or sending spinner
 *
 * Visual changes:
 *
 *   - Host tab bar redesigned as three cards with distinct icons
 *     (Rose/Compass/Sparkles) so visitors can tell them apart at
 *     a glance. Icon choice matches each host's domain.
 *   - Messages use semantic primary/card colors instead of amber
 *     hex, and the assistant bubble now shows a subtle host icon
 *     next to the name so message ownership is clearer
 *   - Composer uses the shared Button primitive; send button has
 *     a paper-plane icon
 *   - Sign-up prompt on rate-limit banner uses the primary-tinted
 *     style consistent with the rest of the site
 */

type HostId = 'laviche' | 'ginger' | 'ahnika'

type HostMeta = {
  id: HostId
  displayName: string
  role: string
  tagline: string
  /** Icon shown on the host card + message avatar. */
  icon: LucideIcon
  /** Inline suggestion copy — appears when the chat is empty. */
  suggestions: string[]
}

const HOSTS: HostMeta[] = [
  {
    id: 'laviche',
    displayName: 'Laviche',
    role: "Maître d'",
    tagline: 'Runs the floor. Knows where everything is.',
    icon: Rose,
    suggestions: [
      'What\u2019s coming up this summer?',
      'How do I get into the cigar lounge?',
      'What\u2019s the difference between Regular and VIP?',
    ],
  },
  {
    id: 'ginger',
    displayName: 'Ginger',
    role: 'Travel concierge',
    tagline: "Adventure travel. Tenerife's her thing.",
    icon: Compass,
    suggestions: [
      'Tell me about Tenerife.',
      'What should I know before visiting the Canaries?',
      'Where would you eat in Santa Cruz?',
    ],
  },
  {
    id: 'ahnika',
    displayName: 'Ahnika',
    role: 'Style + merch',
    tagline: 'Alignment coach meets stylist.',
    icon: Sparkles,
    suggestions: [
      'What should I wear to Ep 1?',
      'Show me something from Concrete Rose.',
      'Help me put together an outfit for a cigar tasting.',
    ],
  },
]

type Message = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// localStorage keys — share the same prefix pattern the mall uses
// so debugging across surfaces is easier.
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

  // Host change — clear chat view, load stored conversation id
  useEffect(() => {
    setMessages([])
    setError(null)
    setRateLimited(null)
    conversationIdRef.current = getStoredConversationId(activeHost)
  }, [activeHost])

  // Pin to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function sendMessage(text?: string) {
    const trimmed = (text ?? input).trim()
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
          'The concierge is offline right now. Try again in a bit — we\u2019re sorting it out.'
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const activeHostMeta = HOSTS.find((h) => h.id === activeHost)!
  const ActiveHostIcon = activeHostMeta.icon

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
                      'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                      active
                        ? 'bg-primary/10 border border-primary/40'
                        : 'bg-muted border border-border'
                    )}
                  >
                    <HostIcon
                      className={cn(
                        'w-4 h-4',
                        active ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
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
                  <ActiveHostIcon className="w-5 h-5 text-primary" />
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
                      disabled={sending}
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
                        <ActiveHostIcon className="w-3 h-3 text-primary" />
                        <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                          {activeHostMeta.displayName}
                        </p>
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
                    <ActiveHostIcon className="w-3 h-3 text-primary" />
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

          {/* Error banner */}
          {error && (
            <div className="mx-6 mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-foreground font-body">{error}</p>
              </div>
            </div>
          )}

          {/* Composer */}
          <div className="border-t border-border p-4 lg:p-6">
            <div className="flex items-end gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={`Message ${activeHostMeta.displayName}…`}
                rows={1}
                disabled={sending}
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
                disabled={sending || !input.trim()}
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

            <p className="mt-3 text-xs text-muted-foreground font-body">
              {isSignedIn
                ? `Signed in as ${userEmail}. ${activeHostMeta.displayName} remembers returning guests.`
                : 'Anonymous chat. Sign in for a larger message allowance and personalized continuity.'}
            </p>
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
