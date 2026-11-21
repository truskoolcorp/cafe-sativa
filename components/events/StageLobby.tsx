'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { stageLobbyPhase, STAGE_INTRO_LEAD_MS } from '@/lib/events/stage-lobby'
import { writeStageSound } from '@/lib/events/stage-sound'
import StageSoundToggle from './StageSoundToggle'

type SoundSession = {
  context: AudioContext
  request: AbortController
  source?: AudioBufferSourceNode
}

type Props = {
  startsAt: string
  serverNow: number
  poster: string
  loop: { webm: string; mp4: string }
  sound?: string
  intro: string
}

export default function StageLobby({ startsAt, serverNow, poster, loop, sound, intro }: Props) {
  const [phase, setPhase] = useState(() => stageLobbyPhase(startsAt, serverNow))
  const [motion, setMotion] = useState(false)
  const [failed, setFailed] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const [soundLoading, setSoundLoading] = useState(false)
  const [soundFailed, setSoundFailed] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<SoundSession | null>(null)
  const stopSound = useCallback(() => {
    const playing = audio.current
    if (!playing) return
    audio.current = null
    playing.request.abort()
    playing.source?.stop()
    void playing.context.close().catch(() => {})
  }, [])

  useEffect(() => {
    const anchor = performance.now()
    let timer: ReturnType<typeof setTimeout>
    function tick() {
      clearTimeout(timer)
      const now = serverNow + performance.now() - anchor
      const next = stageLobbyPhase(startsAt, now)
      setPhase(next)
      if (next === 'lobby' || next === 'intro') {
        const boundary = Date.parse(startsAt) - (next === 'lobby' ? STAGE_INTRO_LEAD_MS : 0)
        timer = setTimeout(tick, Math.min(Math.max(1, boundary - now), 60_000))
      } else {
        stopSound()
      }
    }
    tick()
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [startsAt, serverNow, stopSound])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setMotion(!preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  const lobbyOpen = phase === 'lobby' || phase === 'intro'
  const showMotion = motion && !failed && lobbyOpen
  useEffect(() => {
    if (!showMotion) return
    let mounted = true
    void video.current?.play().catch(() => { if (mounted) setMotion(false) })
    return () => { mounted = false }
  }, [showMotion])

  useEffect(() => stopSound, [stopSound])

  async function toggleSound() {
    if (!sound || !lobbyOpen) return
    if (audio.current) {
      stopSound()
      setSoundOn(false)
      setSoundLoading(false)
      writeStageSound(false)
      return
    }
    let session: SoundSession | null = null
    try {
      const context = new AudioContext()
      const request = new AbortController()
      session = { context, request }
      audio.current = session
      setSoundFailed(false)
      setSoundLoading(true)
      // Resume synchronously from the click, before starting the network work.
      const [, response] = await Promise.all([context.resume(), fetch(sound, { signal: request.signal })])
      if (!response.ok) throw new Error('Lobby audio unavailable')
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      if (audio.current !== session) return
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = true
      source.loopEnd = buffer.duration
      source.connect(gain)
      gain.connect(context.destination)
      gain.gain.setValueAtTime(0, context.currentTime)
      gain.gain.linearRampToValueAtTime(1, context.currentTime + 0.08)
      source.start()
      session.source = source
      setSoundOn(true)
      setSoundLoading(false)
      writeStageSound(true)
    } catch {
      if (audio.current !== session) return
      stopSound()
      setSoundOn(false)
      setSoundLoading(false)
      setSoundFailed(true)
    }
  }

  return (
    <section aria-labelledby="stage-lobby-heading" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-video min-h-48 bg-black">
        {/* Decorative venue imagery: the schedule and welcome are available as text below. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt="" width={1344} height={752} className="absolute inset-0 size-full object-contain" />
        {showMotion && (
          <video ref={video} poster={poster} muted loop playsInline preload="metadata"
            aria-hidden="true" className="pointer-events-none absolute inset-0 size-full object-contain"
            onError={() => setFailed(true)}>
            <source src={loop.webm} type="video/webm" />
            <source src={loop.mp4} type="video/mp4" onError={() => setFailed(true)} />
          </video>
        )}
      </div>
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="stage-lobby-heading" className="font-heading text-2xl font-semibold">Premiere lobby</h2>
          {lobbyOpen && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {!failed && (
                <button type="button" className="text-sm text-primary underline underline-offset-4"
                  onClick={() => setMotion(current => !current)}>
                  {showMotion ? 'Pause Stage ambience' : 'Play Stage ambience'}
                </button>
              )}
              {sound && <StageSoundToggle on={soundOn} busy={soundLoading} toggle={toggleSound} />}
            </div>
          )}
        </div>
        {lobbyOpen && soundFailed && <p role="status" className="text-sm text-muted-foreground">Sound is unavailable. Try again.</p>}
        <div role="status" className="space-y-2">
          {phase === 'intro' ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">House introduction</p>
              <p>{intro}</p>
            </>
          ) : phase === 'kickoff' ? (
            <p>The premiere is starting.</p>
          ) : (
            <p>Find your seat and settle in. The performance will open here at the scheduled time.</p>
          )}
        </div>
      </div>
    </section>
  )
}
