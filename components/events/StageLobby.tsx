'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { stageLobbyPhase, STAGE_INTRO_LEAD_MS } from '@/lib/events/stage-lobby'
import { MIN_STAGE_VOLUME, readStageSound, readStageVolume, writeStageSound, writeStageVolume } from '@/lib/events/stage-sound'
import StageSoundToggle from './StageSoundToggle'

type SoundSession = {
  context: AudioContext
  request: AbortController
  source?: AudioBufferSourceNode
  gain?: GainNode
}

// Keep the optional lobby bed under foreground audio; this does not affect the show.
const LOBBY_SOUND_GAIN = 0.46

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
  const [volume, setVolume] = useState(100)
  const volumeRef = useRef(100)
  const explicitlyMuted = useRef(false)
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

  useEffect(() => {
    const saved = readStageVolume()
    volumeRef.current = saved
    setVolume(saved)
  }, [])

  function updateVolume(value: number) {
    volumeRef.current = value
    setVolume(value)
    writeStageVolume(value)
    const playing = audio.current
    if (!playing?.gain) return
    const now = playing.context.currentTime
    playing.gain.gain.cancelScheduledValues(now)
    playing.gain.gain.setTargetAtTime(LOBBY_SOUND_GAIN * value / 100, now, 0.015)
  }

  const startSound = useCallback(async () => {
    if (!sound || !lobbyOpen || audio.current) return
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
      // Decode at the exported PCM rate so device-rate conversion happens
      // during continuous playback, not at the stored loop endpoints.
      const decoder = new OfflineAudioContext(1, 1, 24_000)
      const buffer = await decoder.decodeAudioData(await response.arrayBuffer())
      if (audio.current !== session) return
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = true
      source.loopEnd = buffer.duration
      source.connect(gain)
      gain.connect(context.destination)
      gain.gain.setValueAtTime(0, context.currentTime)
      gain.gain.linearRampToValueAtTime(LOBBY_SOUND_GAIN * volumeRef.current / 100, context.currentTime + 0.08)
      source.start()
      session.source = source
      session.gain = gain
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
  }, [sound, lobbyOpen, stopSound])

  useEffect(() => {
    if (!lobbyOpen || !sound || explicitlyMuted.current || !readStageSound() || audio.current) return
    function detach() {
      document.removeEventListener('click', activate)
      document.removeEventListener('keydown', activate)
    }
    function activate(event: Event) {
      if (!event.isTrusted || (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key))) return
      if (event.target instanceof Element && event.target.closest('[data-stage-sound-control]')) return
      if (event.target instanceof Element && event.target.closest('a[href], textarea, input, [contenteditable]')) return
      detach()
      if (!explicitlyMuted.current && readStageSound()) void startSound()
    }
    if (navigator.userActivation?.isActive) void startSound()
    else {
      document.addEventListener('click', activate)
      document.addEventListener('keydown', activate)
    }
    return detach
  }, [lobbyOpen, sound, startSound, soundOn])

  function toggleSound() {
    if (audio.current) {
      explicitlyMuted.current = true
      stopSound()
      setSoundOn(false)
      setSoundLoading(false)
      writeStageSound(false)
      return
    }
    explicitlyMuted.current = false
    void startSound()
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
        {lobbyOpen && (!failed || sound) && (
          <details className="absolute bottom-3 right-3 z-10 text-white"
            onKeyDown={event => {
              if (event.key !== 'Escape' || !event.currentTarget.open) return
              event.preventDefault()
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }}>
            <summary className="ml-auto flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-white/30 bg-black/80 text-xl hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true">⋯</span>
              <span className="sr-only">Player options</span>
            </summary>
            <div className="absolute bottom-full right-0 mb-2 w-44 rounded-md border border-white/30 bg-black/90 p-1 shadow-lg">
              {!failed && (
                <button type="button" aria-pressed={!showMotion} className="w-full whitespace-nowrap rounded px-3 py-2 text-left text-sm hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                  onClick={() => setMotion(current => !current)}>
                  Still view<span aria-hidden="true">: {showMotion ? 'Off' : 'On'}</span>
                </button>
              )}
              {sound && (
                <label className="block px-3 py-2 text-sm">
                  <span className="flex justify-between">Volume <span aria-hidden="true">{volume}%</span></span>
                  <input type="range" min={MIN_STAGE_VOLUME} max={100} step={1} value={volume}
                    aria-valuetext={`${volume}%`} onChange={event => updateVolume(event.currentTarget.valueAsNumber)}
                    className="mt-1 h-5 w-full accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" />
                </label>
              )}
            </div>
          </details>
        )}
      </div>
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="stage-lobby-heading" className="font-heading text-2xl font-semibold">Premiere lobby</h2>
          {lobbyOpen && sound && <span data-stage-sound-control><StageSoundToggle on={soundOn} busy={soundLoading} toggle={toggleSound} /></span>}
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
