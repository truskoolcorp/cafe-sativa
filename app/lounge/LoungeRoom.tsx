'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  Crown,
  Loader2,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { confirmLoungeMessage, restoreLoungeMessage } from '@/lib/lounge-message-state'

/**
 * Client-side Lounge room.
 *
 * Responsibilities:
 *   - Subscribe to INSERT events on lounge_messages via Realtime.
 *     The server RLS read policy is re-applied to the subscription
 *     stream so we only get events on messages we're allowed to see.
 *   - Subscribe to UPDATE events to pick up soft-deletes
 *     (deleted_at transitions from null → timestamptz).
 *   - Join a presence channel keyed by room_id to show "X online".
 *   - Composer is tier-gated client-side for UX (explorer sees
 *     "upgrade to post" CTA instead of a text box). RLS enforces
 *     again server-side so tampering the client changes nothing.
 *
 * Race handling:
 *   - We hydrate with the SSR message list. When the user posts,
 *     the message round-trips to the DB, then the Realtime INSERT
 *     event echoes back. We dedupe by message id so the poster
 *     doesn't see their own message appear twice.
 *   - Scroll pin: if the user has scrolled up to read history,
 *     new incoming messages don't yank the viewport. A small
 *     "new messages ↓" badge appears instead.
 */

type Tier = 'explorer' | 'regular' | 'vip'

type Message = {
  id: string
  user_id: string
  author_name: string
  author_tier: string
  is_staff: boolean
  content: string
  created_at: string
}

type Props = {
  roomId: string
  userId: string
  displayName: string
  tier: Tier
  isStaff: boolean
  minPostTier: Tier
  initialMessages: Message[]
  conciergeDrafts?: boolean
  privateRoom?: boolean
  rehearsalDraftModerator?: boolean
  premiereDraftModerator?: boolean
  applauseFor?: string
}

export function LoungeRoom({
  roomId,
  userId,
  displayName,
  tier,
  isStaff,
  minPostTier,
  initialMessages,
  conciergeDrafts = false,
  privateRoom = false,
  rehearsalDraftModerator = false,
  premiereDraftModerator = false,
  applauseFor,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composerMode, setComposerMode] = useState<'chat' | 'host'>('chat')
  const [postStatus, setPostStatus] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [dryRunPaused, setDryRunPaused] = useState(true)
  const [dryRunResult, setDryRunResult] = useState('')
  const [draftHost, setDraftHost] = useState('ahnika')
  const askingHost = conciergeDrafts && composerMode === 'host'
  const hostName = draftHost === 'laviche' ? 'Laviche' : 'Ahnika'
  const hostPrefix = `[Ask ${draftHost}] `
  const maxComposerLength = askingHost ? 2000 - hostPrefix.length : 2000
  const canSendInput = !sending && Boolean(input.trim()) && input.trim().length <= maxComposerLength
  const [presenceCount, setPresenceCount] = useState(1) // ourselves
  const [presenceNames, setPresenceNames] = useState<string[]>([])
  const [newMessageBadge, setNewMessageBadge] = useState(0)

  const listRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrolledToBottomRef = useRef(true) // user is pinned to bottom

  const supabase = useMemo(() => createClient(), [])

  const canPost = useMemo(() => {
    if (minPostTier === 'explorer') return true
    if (minPostTier === 'regular') return tier === 'regular' || tier === 'vip'
    if (minPostTier === 'vip') return tier === 'vip'
    return false
  }, [tier, minPostTier])

  // ------------------------------------------------------------
  // Scroll management
  // ------------------------------------------------------------
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior })
    scrolledToBottomRef.current = true
    setNewMessageBadge(0)
  }, [])

  useEffect(() => {
    // On initial render, jump to the bottom without animation
    scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleListScroll() {
    const el = listRef.current
    if (!el) return
    // "Near the bottom" = within 80px. Forgiving threshold so the user
    // can breathe without us snapping them back.
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80
    scrolledToBottomRef.current = nearBottom
    if (nearBottom && newMessageBadge > 0) {
      setNewMessageBadge(0)
    }
  }

  // ------------------------------------------------------------
  // Realtime subscription
  // ------------------------------------------------------------
  useEffect(() => {
    // Channel for INSERT + UPDATE events on this room
    const channel: RealtimeChannel = supabase
      .channel(`lounge:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lounge_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const incoming = payload.new as Message
          setMessages((prev) => {
            // Dedupe — already inserted locally?
            if (prev.some((m) => m.id === incoming.id)) return prev
            return [...prev, incoming]
          })
          // Only surface the "new message" badge if the user scrolled up
          if (!scrolledToBottomRef.current) {
            setNewMessageBadge((n) => n + 1)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'lounge_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const updated = payload.new as Message & { deleted_at: string | null }
          // Soft-delete: strip from the list
          if (updated.deleted_at) {
            setMessages((prev) => prev.filter((m) => m.id !== updated.id))
          }
        }
      )
      .subscribe()

    // Never broadcast identities on the public presence channel for invite-only rooms.
    if (privateRoom) return () => { void supabase.removeChannel(channel) }
    // Presence channel — separate from postgres_changes
    const presenceChannel = supabase.channel(`presence:lounge:${roomId}`, {
      config: { presence: { key: userId } },
    })

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState<{ name: string }>()
        const keys = Object.keys(state)
        setPresenceCount(keys.length)
        // Take one name per key (presence payloads can have multiple entries
        // per key if the user has multiple tabs open)
        const names = keys
          .map((k) => state[k][0]?.name || 'Member')
          .slice(0, 8)
        setPresenceNames(names)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ name: displayName })
        }
      })

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(presenceChannel)
    }
  }, [supabase, roomId, userId, displayName, privateRoom])

  // ------------------------------------------------------------
  // Auto-scroll when messages grow AND user is at bottom
  // ------------------------------------------------------------
  useEffect(() => {
    if (scrolledToBottomRef.current) {
      // Small timeout so the DOM has rendered the new row before we scroll
      const t = setTimeout(() => scrollToBottom(), 50)
      return () => clearTimeout(t)
    }
  }, [messages, scrollToBottom])

  // ------------------------------------------------------------
  // Send
  // ------------------------------------------------------------
  async function send(asHostQuestion = false, reaction?: string) {
    const plain = reaction ?? input.trim()
    const content = asHostQuestion ? `${hostPrefix}${plain}` : plain
    if (!plain || sending || !canPost || content.length > 2000 || (asHostQuestion && !conciergeDrafts)) return

    setError(null)
    setPostStatus('')
    setSending(true)

    // Optimistic update — we append immediately, then dedupe when
    // the Realtime echo comes back.
    const localId = `local-${Date.now()}`
    const optimistic: Message = {
      id: localId,
      user_id: userId,
      author_name: displayName,
      author_tier: tier,
      is_staff: isStaff,
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    if (!reaction) setInput('')

    try {
      const res = await fetch('/api/lounge/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId, content }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        // Roll back optimistic message
        setMessages((prev) => prev.filter((m) => m.id !== localId))
        if (!reaction) setInput(plain) // let them retry
        if (res.status === 429) {
          setError('Slow down — up to 10 messages per minute.')
        } else if (res.status === 403 && data.code === 'tier_insufficient') {
          setError('Regular or VIP members can post. Upgrade to join the conversation.')
        } else {
          setError(data?.error || 'Could not post.')
        }
        setSending(false)
        return
      }

      // Replace the optimistic message with the real one so the id matches
      // when the Realtime echo arrives.
      if (typeof data?.id !== 'string' || typeof data?.created_at !== 'string') {
        throw new Error('Could not confirm the post. Check the conversation before trying again.')
      }
      setMessages((prev) => confirmLoungeMessage(prev, localId, { id: data.id, created_at: data.created_at }))
      if (asHostQuestion) {
        setPostStatus(`Question for ${hostName} posted in this room. A moderator reviews concierge replies before they appear.`)
      }
    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== localId))
      if (!reaction) setInput(plain)
      setError(err?.message || 'Could not post.')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(askingHost)
    }
  }

  async function handleDelete(messageId: string) {
    // Remove locally first (optimistic)
    const removed = messages.find((message) => message.id === messageId)
    setMessages((prev) => prev.filter((m) => m.id !== messageId))
    try {
      const res = await fetch('/api/lounge/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId }),
      })
      if (!res.ok) {
        // Roll back
        setMessages((prev) => removed ? restoreLoungeMessage(prev, removed) : prev)
        const data = await res.json().catch(() => ({}))
        setError(data?.error || 'Could not delete.')
      }
    } catch {
      setMessages((prev) => removed ? restoreLoungeMessage(prev, removed) : prev)
      setError('Could not delete.')
    }
  }

  async function draftConciergeReply(message: Message, dryRun = false) {
    if (!canDraft || drafting || (!dryRun && input.trim()) || (dryRun && !privateRoom)) return
    setDrafting(true)
    setError(null)
    try {
      const res = await fetch('/api/lounge/concierge-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.id, rehearsal: privateRoom, dryRun, paused: dryRunPaused, host: message.content.startsWith('[Ask laviche] ') ? 'laviche' : 'ahnika' }),
      })
      const data = await res.json()
      if (res.ok && dryRun && data.decision) {
        setDryRunResult(data.decision.action === 'eligible' && typeof data.decision.text === 'string'
          ? `Would answer: ${data.decision.text}`
          : `Would hand off (${data.decision.reason}).`)
        return
      }
      if (!res.ok || typeof data.draft !== 'string' || typeof data.attribution !== 'string') {
        throw new Error('Draft unavailable')
      }
      setComposerMode('chat')
      setPostStatus('')
      setInput(current => current.trim() ? current : `${data.attribution}: ${data.draft}`)
    } catch {
      setError('Could not draft a reply. You can still reply as moderator.')
    } finally {
      setDrafting(false)
    }
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  const canDraft = conciergeDrafts && (privateRoom ? rehearsalDraftModerator : isStaff || premiereDraftModerator)
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Presence bar */}
      {!privateRoom && <div className="flex items-center gap-2 py-3 text-xs font-body text-muted-foreground border-b border-border">
        <Users className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold text-foreground">
          {presenceCount}
        </span>
        {presenceCount === 1 ? 'online' : 'online'}
        {presenceNames.length > 1 && (
          <span className="truncate hidden sm:inline">
            &middot;{' '}
            {presenceNames.slice(0, 5).join(', ')}
            {presenceCount > 5 && ` +${presenceCount - 5}`}
          </span>
        )}
      </div>}

      {/* Message list */}
      {privateRoom && canDraft && (
        <div className="space-y-1 py-2 text-xs text-muted-foreground">
          <label><input type="checkbox" checked={dryRunPaused}
            onChange={e => setDryRunPaused(e.target.checked)} /> Pause rehearsal simulations</label>
          <p role="status">{dryRunResult || 'Dry run only. Results are not sent to chat.'}</p>
        </div>
      )}
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="flex-1 overflow-y-auto py-4 space-y-2 relative"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground font-body">
              Quiet in here. Say hi.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              formatHostQuestion={conciergeDrafts}
              canDelete={isStaff || m.user_id === userId}
              onDelete={() => handleDelete(m.id)}
              onDraft={canDraft && m.user_id !== userId && /^\[Ask (ahnika|laviche)\] /.test(m.content)
                ? () => draftConciergeReply(m) : undefined}
              draftDisabled={drafting || Boolean(input.trim())}
              onDryRun={privateRoom && canDraft && m.user_id !== userId && /^\[Ask (ahnika|laviche)\] /.test(m.content)
                ? () => draftConciergeReply(m, true) : undefined}
            />
          ))
        )}
        <div ref={bottomRef} />

        {newMessageBadge > 0 && (
          <button
            onClick={() => scrollToBottom()}
            className="sticky bottom-4 mx-auto block rounded-full bg-primary text-primary-foreground text-xs font-body font-semibold px-3 py-1.5 shadow-lg hover:bg-primary/90 transition-colors"
          >
            {newMessageBadge} new message
            {newMessageBadge === 1 ? '' : 's'} ↓
          </button>
        )}
      </div>

      {/* Composer or upgrade prompt */}
      <div className="border-t border-border pt-4 pb-2">
        {error && (
          <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-foreground font-body">{error}</p>
            </div>
          </div>
        )}

        {canPost && conciergeDrafts && (
          <div className="mb-3 space-y-2">
            <div role="group" aria-label="Message destination" className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant={askingHost ? 'outline' : 'default'}
                aria-pressed={!askingHost} disabled={sending || drafting} onClick={() => setComposerMode('chat')}>
                Room chat
              </Button>
              <Button type="button" size="sm" variant={askingHost ? 'default' : 'outline'}
                aria-pressed={askingHost} disabled={sending || drafting} onClick={() => setComposerMode('host')}>
                Ask a host
              </Button>
              {askingHost && <label className="flex items-center gap-2 text-sm text-foreground">
                Host <select className="rounded border border-border bg-background p-1"
                  value={draftHost} onChange={event => setDraftHost(event.target.value)} disabled={sending || drafting}>
                  <option value="ahnika">Ahnika</option><option value="laviche">Laviche</option>
                </select>
              </label>}
            </div>
            <p className="text-xs text-muted-foreground">
              {askingHost
                ? 'Your question is visible to this room. A moderator reviews concierge replies before they appear.'
                : 'Send a message to the room, or choose Ask a host to direct a question to Ahnika or Laviche.'}
            </p>
          </div>
        )}
        {canPost ? (
          <div className="flex items-end gap-2">
            <textarea
              aria-label={askingHost ? `Question for ${hostName}` : 'Message to the room'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={askingHost ? `Ask ${hostName} a question…` : 'Message the room…'}
              rows={1}
              maxLength={maxComposerLength}
              disabled={sending}
              className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              style={{ minHeight: '44px', maxHeight: '160px' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 160) + 'px'
              }}
            />
            <Button
              type="button"
              onClick={() => send(askingHost)}
              disabled={!canSendInput}
              aria-label={askingHost ? 'Send question' : 'Send message'}
              className="shrink-0 gap-1.5"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {conciergeDrafts && <span>{askingHost ? 'Send question' : 'Send'}</span>}
            </Button>
          </div>
        ) : (
          <UpgradePrompt />
        )}
        {canPost && askingHost && input.trim().length > maxComposerLength && (
          <p className="mt-2 text-xs text-muted-foreground">Shorten your question to {maxComposerLength} characters to send it.</p>
        )}
        <p role="status" aria-atomic="true" className={postStatus ? 'mt-2 text-sm text-primary' : 'sr-only'}>
          {postStatus}
        </p>
        {canPost && applauseFor && (
          <button type="button" className="ml-3 mt-2 text-sm text-primary underline disabled:opacity-50"
            disabled={sending} onClick={() => send(false, `👏 Applause for ${applauseFor}!`)}>
            Applaud {applauseFor}
          </button>
        )}
        <p className="mt-2 text-xs text-muted-foreground font-body text-center">
          Posting as{' '}
          <span className="text-foreground font-semibold">{displayName}</span>{' '}
          &middot; Enter to send, Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}

function MessageRow({
  message,
  formatHostQuestion,
  canDelete,
  onDelete,
  onDraft,
  draftDisabled,
  onDryRun,
}: {
  message: Message
  formatHostQuestion: boolean
  canDelete: boolean
  onDelete: () => void
  onDraft?: () => void
  draftDisabled?: boolean
  onDryRun?: () => void
}) {
  const time = new Date(message.created_at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
  const hostQuestion = formatHostQuestion ? /^\[Ask (ahnika|laviche)\] /.exec(message.content) : null

  return (
    <div className="group rounded-lg px-3 py-2 hover:bg-card/50 transition-colors">
      <div className="flex items-baseline gap-2 mb-0.5">
        <span
          className={cn(
            'font-body font-semibold text-sm',
            message.is_staff
              ? 'text-primary'
              : message.author_tier === 'vip'
                ? 'text-primary'
                : 'text-foreground'
          )}
        >
          {message.author_name}
        </span>
        {message.is_staff && (
          <ShieldCheck className="w-3 h-3 text-primary" />
        )}
        {message.author_tier === 'vip' && !message.is_staff && (
          <Crown className="w-3 h-3 text-primary" />
        )}
        <span className="text-[11px] text-muted-foreground font-body">
          {time}
        </span>
        {onDraft && <button type="button" onClick={onDraft} disabled={draftDisabled}
          className="text-xs text-primary underline disabled:opacity-50">Draft host reply</button>}
        {onDryRun && <button type="button" onClick={onDryRun} className="text-xs text-primary underline">Dry run</button>}
        {canDelete && (
          <button
            onClick={onDelete}
            className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
            aria-label="Delete message"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {hostQuestion && <p className="mb-1 text-xs font-semibold text-primary">
        Question for {hostQuestion[1] === 'laviche' ? 'Laviche' : 'Ahnika'}
      </p>}
      <p className="text-sm text-foreground font-body leading-relaxed whitespace-pre-wrap break-words">
        {hostQuestion ? message.content.slice(hostQuestion[0].length) : message.content}
      </p>
    </div>
  )
}

function UpgradePrompt() {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-center">
      <p className="text-sm text-foreground font-body mb-3 leading-relaxed">
        Explorer members can read the Lounge. Upgrade to join the conversation.
      </p>
      <Button size="sm" asChild>
        <Link href="/membership">
          See membership tiers
        </Link>
      </Button>
    </div>
  )
}
