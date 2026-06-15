'use client'
/**
 * /host/avatar — Live Avatar Host Console (Episode 2+)
 *
 * Architecture:
 *   Guest speaks in Zoom → Zoom live transcript → /api/host/respond
 *   → Claude (Keith or Laviche persona) → ElevenLabs TTS → HeyGen Interactive Avatar
 *   → OBS virtual camera → Zoom as second participant
 *
 * This page is the operator console. Run it on a second machine or second window
 * while Zoom is open. Paste guest transcript lines manually, or wire
 * Zoom's live transcript webhook to POST /api/host/transcript.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY
 *   ELEVENLABS_API_KEY
 *   HEYGEN_API_KEY
 *   NEXT_PUBLIC_HOST_SECRET   (locks this page to authorized operators)
 */

import { useEffect, useRef, useState, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────
type HostId = 'keith' | 'laviche'
type MsgRole = 'keith' | 'laviche' | 'guest' | 'system'

interface Message {
  id: string
  role: MsgRole
  speaker: string
  text: string
  ts: Date
  pending?: boolean
}

interface PipelineStatus {
  claude: 'idle' | 'thinking' | 'done' | 'error'
  tts: 'idle' | 'generating' | 'playing' | 'error'
  avatar: 'idle' | 'animating' | 'error'
}

// ── Constants ─────────────────────────────────────────────────────────────
const VOICES = {
  keith: process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_KEITH || '9I3zeSiEilh5b2sSFWdK',
  laviche: process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_LAVICHE || 'v0r5L5uDA6ocN9hjTPYK',
} as const

const HEYGEN_AVATARS = {
  keith: process.env.NEXT_PUBLIC_HEYGEN_AVATAR_KEITH || 'e9a45c47c2514c4f899cc00460c981a2',
  laviche: process.env.NEXT_PUBLIC_HEYGEN_AVATAR_LAVICHE || 'b320213eeaf94f16a3ec32ca4fd99574',
} as const

const HOST_PERSONAS = {
  keith: `You are Keith Ingram — founder and CEO of Café Sativa, Dallas-born, Gulf War veteran,
IT specialist turned cultural architect. You host At The Table, an intimate live conversation series.
Tone: warm, direct, thoughtful, occasionally funny. You speak in complete sentences. You do not
use filler words. You reference your life honestly — Dallas roots, global travel, building Café
Sativa as a cultural institution, not just a business. Keep responses 2-4 sentences unless the
moment calls for more. You are the host, so you guide the room — but you listen deeply first.`,
  laviche: `You are Laviche Cárdenas — co-host of At The Table and the heartbeat of Café Sativa.
You bring warmth, depth, and a poetic sensibility to every conversation. You occasionally use
Spanish endearments naturally (amores, mija/mijo, corazón). You center the emotional truth in
what guests say. You are not a moderator — you are a co-creator of the moment. Tone: luminous,
curious, grounding. Keep responses 2-4 sentences. When a guest shares something vulnerable,
you hold space before pivoting. Never rush.`,
} as const

// ── Colors (Café Sativa palette) ──────────────────────────────────────────
const C = {
  bg: '#0a0705',
  surface: '#130e08',
  card: '#1a1208',
  border: '#2c1e0c',
  borderBright: '#4a3218',
  gold: '#b8813a',
  goldDim: '#7a5526',
  green: '#3d9e6a',
  red: '#9e3d3d',
  amber: '#d4902a',
  text: '#e8ddd0',
  textDim: '#9e8870',
  muted: '#5a4535',
  keith: '#6ab8d4',
  keithBg: '#0d2535',
  laviche: '#d4729a',
  lavicheBg: '#2d0f1e',
} as const

const CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:${C.bg};color:${C.text};font-family:'Inter',-apple-system,sans-serif;height:100vh;display:grid;grid-template-rows:52px 1fr;overflow:hidden}
  ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:${C.borderBright};border-radius:4px}
  textarea{resize:none;outline:none;font-family:inherit}
  button{cursor:pointer;font-family:inherit}
`

// ── Helpers ────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }
function fmt(d: Date) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }

// ── Main component ─────────────────────────────────────────────────────────
export default function AvatarHostPage() {
  const [activeHost, setActiveHost] = useState<HostId>('keith')
  const [messages, setMessages] = useState<Message[]>([{
    id: uid(), role: 'system', speaker: 'System', ts: new Date(),
    text: 'Avatar host console ready. Paste guest input below or configure Zoom transcript webhook to POST /api/host/transcript.'
  }])
  const [guestInput, setGuestInput] = useState('')
  const [customLine, setCustomLine] = useState('')
  const [pipeline, setPipeline] = useState<PipelineStatus>({ claude: 'idle', tts: 'idle', avatar: 'idle' })
  const [isLive, setIsLive] = useState(false)
  const [audioEl] = useState(() => typeof window !== 'undefined' ? new Audio() : null)
  const logRef = useRef<HTMLDivElement>(null)
  const heygenRef = useRef<HTMLIFrameElement>(null)

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages])

  // ── Add message ──
  const addMsg = useCallback((role: MsgRole, speaker: string, text: string, pending = false): string => {
    const id = uid()
    setMessages(prev => [...prev, { id, role, speaker, text, ts: new Date(), pending }])
    return id
  }, [])

  const resolveMsg = useCallback((id: string, text: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, text, pending: false } : m))
  }, [])

  // ── Step 1: Send guest input to Claude persona engine ──
  const generateResponse = useCallback(async (guestText: string) => {
    if (!guestText.trim() || pipeline.claude === 'thinking') return

    // Log guest utterance
    addMsg('guest', 'Guest', guestText)
    setGuestInput('')

    // Pending host response
    const host = activeHost
    const hostName = host === 'keith' ? 'Keith Ingram' : 'Laviche Cárdenas'
    const pendingId = addMsg(host, hostName, '...', true)

    setPipeline(p => ({ ...p, claude: 'thinking' }))

    try {
      // Call Claude via /api/host/respond
      const res = await fetch('/api/host/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          persona: HOST_PERSONAS[host],
          guestText,
          history: messages.slice(-8).map(m => ({
            role: m.role === 'guest' ? 'user' : 'assistant',
            content: `[${m.speaker}]: ${m.text}`
          }))
        })
      })

      const { response } = await res.json()
      resolveMsg(pendingId, response)
      setPipeline(p => ({ ...p, claude: 'done' }))

      // Step 2: TTS
      await speakText(response, host)

    } catch (err) {
      resolveMsg(pendingId, '[Error generating response — check API keys]')
      setPipeline(p => ({ ...p, claude: 'error' }))
    }
  }, [pipeline.claude, activeHost, messages, addMsg, resolveMsg])

  // ── Step 2: ElevenLabs TTS ──
  const speakText = useCallback(async (text: string, host: HostId) => {
    setPipeline(p => ({ ...p, tts: 'generating' }))
    try {
      const res = await fetch('/api/host/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId: VOICES[host] })
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)

      if (audioEl) {
        audioEl.src = url
        audioEl.onplay = () => {
          setPipeline(p => ({ ...p, tts: 'playing' }))
          // Step 3: trigger HeyGen avatar animation
          animateAvatar(text, host)
        }
        audioEl.onended = () => {
          setPipeline(p => ({ ...p, tts: 'idle', avatar: 'idle' }))
          URL.revokeObjectURL(url)
        }
        await audioEl.play()
      }
    } catch {
      setPipeline(p => ({ ...p, tts: 'error' }))
    }
  }, [audioEl])

  // ── Step 3: HeyGen Interactive Avatar ──
  const animateAvatar = useCallback(async (text: string, host: HostId) => {
    setPipeline(p => ({ ...p, avatar: 'animating' }))
    try {
      await fetch('/api/host/avatar-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, avatarId: HEYGEN_AVATARS[host] })
      })
    } catch {
      setPipeline(p => ({ ...p, avatar: 'error' }))
    }
  }, [])

  // ── Speak a custom scripted line ──
  const speakCustomLine = useCallback(async () => {
    if (!customLine.trim()) return
    const host = activeHost
    const hostName = host === 'keith' ? 'Keith Ingram' : 'Laviche Cárdenas'
    addMsg(host, hostName, customLine)
    const line = customLine
    setCustomLine('')
    await speakText(line, host)
  }, [customLine, activeHost, addMsg, speakText])

  // ── Render ─────────────────────────────────────────────────────────────
  const pipeColor = (s: string) =>
    s === 'idle' ? C.muted :
    s === 'thinking' || s === 'generating' || s === 'animating' ? C.amber :
    s === 'playing' || s === 'done' ? C.green : C.red

  const pipeLabel = (s: string) =>
    s === 'idle' ? 'idle' :
    s === 'thinking' ? 'thinking...' :
    s === 'generating' ? 'generating...' :
    s === 'playing' ? 'playing' :
    s === 'animating' ? 'animating' :
    s === 'done' ? 'done' : 'error'

  const quickLines = [
    { host: 'keith' as HostId, text: "Welcome to the table, family. This is what we built Café Sativa for — real conversation, real people." },
    { host: 'laviche' as HostId, text: "Bienvenidos, amores. Your presence here tonight means everything." },
    { host: 'keith' as HostId, text: "The floor is open — who wants to share first?" },
    { host: 'laviche' as HostId, text: "That is so beautifully said. Can I sit with that for a moment?" },
    { host: 'keith' as HostId, text: "Thank you for being at the table tonight. Y'all made this real." },
    { host: 'laviche' as HostId, text: "Until next time — keep glowing, keep growing. Besitos, amores." },
  ]

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Header */}
      <header style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.gold, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Café Sativa</span>
        <span style={{ color: C.muted }}>›</span>
        <span style={{ fontSize: 13, color: C.textDim }}>Avatar Host Console — Episode 2+</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Pipeline status */}
          {(['claude', 'tts', 'avatar'] as const).map(k => (
            <span key={k} style={{ fontSize: 11, color: pipeColor(pipeline[k]) }}>
              {k}: {pipeLabel(pipeline[k])}
            </span>
          ))}
          <div style={{
            fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
            background: isLive ? '#0d2a18' : C.card,
            border: `1px solid ${isLive ? C.green : C.border}`,
            color: isLive ? C.green : C.muted,
            textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 6
          }}>
            {isLive && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'none' }} />}
            {isLive ? 'Live' : 'Offline'}
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={{ display: 'grid', gridTemplateColumns: '1fr 360px', overflow: 'hidden' }}>

        {/* Left: Avatar stage + transcript */}
        <div style={{ display: 'grid', gridTemplateRows: '220px 1fr', overflow: 'hidden', borderRight: `1px solid ${C.border}` }}>

          {/* Avatar stage */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: C.border }}>
            {(['keith', 'laviche'] as HostId[]).map(h => {
              const isSpeaking = pipeline.tts === 'playing' && activeHost === h
              const color = h === 'keith' ? C.keith : C.laviche
              const bg = h === 'keith' ? C.keithBg : C.lavicheBg
              return (
                <div key={h} style={{ background: isSpeaking ? bg : C.card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, position: 'relative', transition: 'background 0.3s' }}>
                  <div style={{
                    width: 88, height: 88, borderRadius: '50%',
                    border: `2px solid ${isSpeaking ? color : C.borderBright}`,
                    boxShadow: isSpeaking ? `0 0 20px ${color}44` : 'none',
                    background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 28, fontWeight: 700, color: isSpeaking ? color : C.textDim,
                    transition: 'all 0.3s'
                  }}>
                    {h === 'keith' ? 'KI' : 'LC'}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{h === 'keith' ? 'Keith Ingram' : 'Laviche Cárdenas'}</div>
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{h === 'keith' ? 'Founder & Host' : 'Co-Host & Concierge'}</div>
                  </div>
                  {isSpeaking && (
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center', position: 'absolute', bottom: 12 }}>
                      {[8, 14, 10, 16, 8].map((h2, i) => (
                        <div key={i} style={{ width: 3, borderRadius: 2, background: color, height: h2, animation: `soundwave 0.8s ease-in-out ${i * 0.1}s infinite alternate` }} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Transcript log */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 20px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Live Transcript
            </div>
            <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {messages.map(m => (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      background: m.role === 'keith' ? C.keithBg : m.role === 'laviche' ? C.lavicheBg : C.card,
                      color: m.role === 'keith' ? C.keith : m.role === 'laviche' ? C.laviche : C.textDim,
                      border: `1px solid ${m.role === 'keith' ? C.keith + '44' : m.role === 'laviche' ? C.laviche + '44' : C.border}`,
                    }}>
                      {m.speaker}
                    </span>
                    <span style={{ fontSize: 10, color: C.muted }}>{fmt(m.ts)}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: m.pending ? C.muted : C.textDim, fontStyle: m.pending ? 'italic' : 'normal', paddingLeft: 2 }}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div style={{ background: C.surface, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Session */}
          <div style={{ padding: 16, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Session</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button onClick={() => setIsLive(true)} style={{ padding: '9px 0', borderRadius: 5, border: 'none', background: C.green, color: '#0a0705', fontSize: 12, fontWeight: 700 }}>▶ Go Live</button>
              <button onClick={() => setIsLive(false)} style={{ padding: '9px 0', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 12, fontWeight: 700 }}>■ End</button>
            </div>
          </div>

          {/* Active host selector */}
          <div style={{ padding: 16, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Active host</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(['keith', 'laviche'] as HostId[]).map(h => (
                <button key={h} onClick={() => setActiveHost(h)} style={{
                  padding: '8px 0', borderRadius: 5, fontSize: 12, fontWeight: 600, textAlign: 'center',
                  background: activeHost === h ? (h === 'keith' ? C.keithBg : C.lavicheBg) : C.card,
                  border: `1px solid ${activeHost === h ? (h === 'keith' ? C.keith : C.laviche) : C.borderBright}`,
                  color: activeHost === h ? (h === 'keith' ? C.keith : C.laviche) : C.textDim,
                  transition: 'all 0.15s'
                }}>
                  {h === 'keith' ? 'Keith' : 'Laviche'}
                </button>
              ))}
            </div>
          </div>

          {/* Guest input → AI response */}
          <div style={{ padding: 16, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Guest says → host responds</div>
            <textarea
              value={guestInput}
              onChange={e => setGuestInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generateResponse(guestInput) }}
              placeholder="Paste or type what the guest just said... Cmd+Enter to generate response"
              style={{ width: '100%', height: 80, background: C.card, border: `1px solid ${C.borderBright}`, borderRadius: 6, padding: '10px 12px', color: C.text, fontSize: 13, lineHeight: 1.5 }}
            />
            <button
              onClick={() => generateResponse(guestInput)}
              disabled={pipeline.claude === 'thinking' || !guestInput.trim()}
              style={{ marginTop: 8, width: '100%', padding: '10px 0', borderRadius: 5, border: 'none', background: pipeline.claude === 'thinking' ? C.goldDim : C.gold, color: '#0a0705', fontSize: 12, fontWeight: 700, opacity: !guestInput.trim() ? 0.5 : 1 }}
            >
              {pipeline.claude === 'thinking' ? 'Generating...' : `Respond as ${activeHost === 'keith' ? 'Keith' : 'Laviche'} →`}
            </button>
          </div>

          {/* Custom scripted line */}
          <div style={{ padding: 16, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Scripted line (bypass AI)</div>
            <textarea
              value={customLine}
              onChange={e => setCustomLine(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) speakCustomLine() }}
              placeholder="Type exactly what to say — goes straight to TTS and avatar..."
              style={{ width: '100%', height: 60, background: C.card, border: `1px solid ${C.borderBright}`, borderRadius: 6, padding: '10px 12px', color: C.text, fontSize: 13 }}
            />
            <button onClick={speakCustomLine} style={{ marginTop: 8, width: '100%', padding: '9px 0', borderRadius: 5, border: `1px solid ${C.borderBright}`, background: 'transparent', color: C.textDim, fontSize: 12, fontWeight: 700 }}>
              Speak line →
            </button>
          </div>

          {/* Quick lines */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Quick lines</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {quickLines.map((ql, i) => (
                <button key={i} onClick={() => {
                  setActiveHost(ql.host)
                  setCustomLine(ql.text)
                }} style={{
                  padding: '8px 10px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 5,
                  color: C.textDim, fontSize: 11, textAlign: 'left', lineHeight: 1.4, transition: 'all 0.15s'
                }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: ql.host === 'keith' ? C.keith : C.laviche, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 2 }}>
                    {ql.host}
                  </span>
                  {ql.text.length > 80 ? ql.text.slice(0, 80) + '…' : ql.text}
                </button>
              ))}
            </div>
          </div>

        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes soundwave { from{transform:scaleY(0.4)} to{transform:scaleY(1)} }
      ` }} />
    </>
  )
}
