'use client'

import { useEffect, useRef, useState } from 'react'
import { DRESS_PLAYOUT_BUFFER_MS, dressLateJoinPosition, dressPlayoutEndsAt } from '@/lib/events/stage-dress-playout'
import { readStageSound, readStageVolume, writeStageSound, writeStageVolume } from '@/lib/events/stage-sound'

type Clip = 'intro' | 'performance'
type Display = Clip | 'waiting' | 'ended' | 'unavailable'
const clipUrl = {
  intro: '/api/stage/rehearsal-cue/intro',
  performance: '/api/stage/rehearsal-cue/performance',
}

export default function StageDressPlayer({ introAt, kickoff, cutoff, serverNow }: {
  introAt: number; kickoff: number; cutoff: number; serverNow: number
}) {
  const intro = useRef<HTMLVideoElement>(null)
  const performance = useRef<HTMLVideoElement>(null)
  const clock = useRef({ serverNow, anchor: 0 })
  const requestContinue = useRef<(() => void) | null>(null)
  const active = useRef<Clip | null>(null)
  const wantedSound = useRef(false)
  const [display, setDisplay] = useState<Display>('waiting')
  const [soundOn, setSoundOn] = useState(false)
  const [volume, setVolume] = useState(100)
  const [needsPlay, setNeedsPlay] = useState(false)

  useEffect(() => {
    const a = intro.current
    const b = performance.current
    if (!a || !b) return
    const players = { intro: a, performance: b }
    const playoutEnd = dressPlayoutEndsAt(cutoff)
    const now = () => clock.current.serverNow + window.performance.now() - clock.current.anchor
    clock.current.anchor = window.performance.now()
    let stopped = false
    let waitingForPerformance = false
    let generation = 0
    let blockedClip: Clip | null = null
    const timers: ReturnType<typeof setTimeout>[] = []
    const schedule = (at: number, action: () => void) => {
      timers.push(setTimeout(() => { if (!stopped) action() }, Math.max(0, at - now())))
    }

    wantedSound.current = readStageSound()
    setSoundOn(wantedSound.current)
    const savedVolume = readStageVolume()
    setVolume(savedVolume)
    a.volume = b.volume = savedVolume / 100

    function load(which: Clip) {
      if (now() >= cutoff) return
      const player = players[which]
      if (player.getAttribute('src')) return
      player.preload = 'auto'
      player.src = clipUrl[which]
      player.load()
    }

    function show(which: Clip, attempt: number) {
      if (stopped || generation !== attempt) return
      active.current = which
      setDisplay(which)
      if (which === 'performance') players.intro.pause()
    }

    function play(which: Clip, manual = false) {
      if (stopped || now() >= playoutEnd || active.current === 'performance' && which === 'intro') return
      const player = players[which]
      if (!player.getAttribute('src')) return
      if (which === 'performance' && now() < kickoff) return
      const attempt = ++generation
      let exposed = false
      const showOnce = () => {
        if (exposed || stopped || generation !== attempt) return
        exposed = true
        show(which, attempt)
      }
      const reveal = () => {
        if (typeof player.requestVideoFrameCallback === 'function') {
          player.requestVideoFrameCallback(showOnce)
          schedule(now() + 100, () => {
            if (!player.paused && player.currentTime > 0 && player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) showOnce()
          })
        } else {
          showOnce()
        }
      }
      const playMuted = () => {
        player.muted = true
        setSoundOn(false)
        player.play().then(reveal, () => {
          if (stopped || generation !== attempt) return
          blockedClip = which
          setNeedsPlay(true)
        })
      }
      blockedClip = null
      setNeedsPlay(false)
      player.muted = !wantedSound.current
      player.play().then(() => {
        if (stopped || generation !== attempt) return
        setSoundOn(!player.muted)
        reveal()
      }, (err: unknown) => {
        if (stopped || generation !== attempt) return
        if (err instanceof Error && err.name === 'NotAllowedError' && !player.muted && !manual) {
          playMuted()
        } else {
          blockedClip = which
          setNeedsPlay(true)
        }
      })
    }

    function startPerformance(fromIntro: boolean) {
      if (stopped || now() >= cutoff || waitingForPerformance) return
      load('performance')
      const player = players.performance
      waitingForPerformance = true
      if (!fromIntro) {
        const seek = dressLateJoinPosition(now(), kickoff, player.duration)
        if (seek > 0) player.currentTime = seek
      }
      if (player.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) setDisplay('waiting')
      play('performance')
    }

    function introEnded() {
      if (now() < kickoff) {
        schedule(kickoff + 60, () => startPerformance(true))
      } else {
        startPerformance(true)
      }
    }

    function finish() {
      generation++
      a?.pause()
      b?.pause()
      setNeedsPlay(false)
      setDisplay('ended')
    }

    function onMediaError(event: Event) {
      if (stopped || now() >= cutoff) return
      const player = event.currentTarget
      if (player === a && now() >= kickoff && !waitingForPerformance) {
        load('performance')
        startPerformance(false)
      } else if (!waitingForPerformance || player === b) {
        generation++
        setNeedsPlay(false)
        setDisplay('unavailable')
      }
    }

    requestContinue.current = () => {
      if (blockedClip) play(blockedClip, true)
    }
    a.addEventListener('ended', introEnded)
    b.addEventListener('ended', finish)
    a.addEventListener('error', onMediaError)
    b.addEventListener('error', onMediaError)
    const initial = now()
    const late = initial >= kickoff - DRESS_PLAYOUT_BUFFER_MS

    if (initial < cutoff) {
      schedule(kickoff + 60, () => load('performance'))
      if (late) {
        schedule(kickoff + DRESS_PLAYOUT_BUFFER_MS, () => {
          load('performance')
          if (b.readyState < HTMLMediaElement.HAVE_METADATA) {
            b.addEventListener('loadedmetadata', () => startPerformance(false), { once: true })
          } else startPerformance(false)
        })
      } else {
        schedule(introAt + 60, () => load('intro'))
        schedule(introAt + DRESS_PLAYOUT_BUFFER_MS, () => {
          if (now() >= kickoff) { load('performance'); startPerformance(false); return }
          const startIntro = () => {
            if (stopped) return
            if (now() >= kickoff) { load('performance'); startPerformance(false); return }
            const seek = dressLateJoinPosition(now(), introAt, a.duration)
            if (seek > 0) a.currentTime = seek
            play('intro')
          }
          if (a.readyState < HTMLMediaElement.HAVE_METADATA) {
            a.addEventListener('loadedmetadata', startIntro, { once: true })
          } else startIntro()
        })
        schedule(kickoff + DRESS_PLAYOUT_BUFFER_MS, () => {
          if (a.paused || a.ended) startPerformance(false)
        })
      }
      schedule(playoutEnd, finish)
    } else {
      finish()
    }

    return () => {
      stopped = true
      generation++
      timers.forEach(clearTimeout)
      requestContinue.current = null
      active.current = null
      a.removeEventListener('ended', introEnded)
      b.removeEventListener('ended', finish)
      a.removeEventListener('error', onMediaError)
      b.removeEventListener('error', onMediaError)
      for (const player of [a, b]) {
        player.pause()
        player.removeAttribute('src')
        player.load()
      }
    }
  }, [introAt, kickoff, cutoff])

  function toggleSound() {
    const next = !soundOn
    wantedSound.current = next
    writeStageSound(next)
    for (const player of [intro.current, performance.current]) if (player) player.muted = !next
    setSoundOn(next)
    requestContinue.current?.()
  }

  function adjustVolume(value: number) {
    setVolume(value)
    writeStageVolume(value)
    for (const player of [intro.current, performance.current]) if (player) player.volume = value / 100
  }

  return (
    <div className="space-y-2" aria-label="Private synchronized Stage player">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button type="button" className="underline" onClick={toggleSound}>Sound: {soundOn ? 'On' : 'Off'}</button>
        <label className="flex items-center gap-2 text-sm">Volume
          <input aria-label="Stage volume" type="range" min={5} max={100} value={volume}
            onChange={event => adjustVolume(Number(event.currentTarget.value))} />
        </label>
      </div>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <video ref={intro} playsInline muted preload="none" aria-label="Laviche’s captioned welcome"
          aria-hidden={display !== 'intro'} style={{ visibility: display === 'intro' ? 'visible' : 'hidden' }}
          className="absolute inset-0 h-full w-full">
          <track kind="captions" srcLang="en" label="English" src="/api/stage/rehearsal-cue/captions" default />
        </video>
        <video ref={performance} playsInline muted preload="none" aria-label="Ahnika Merlot’s performance"
          aria-hidden={display !== 'performance'} style={{ visibility: display === 'performance' ? 'visible' : 'hidden' }}
          className="absolute inset-0 h-full w-full" />
        {(display === 'waiting' || display === 'ended' || display === 'unavailable') &&
          <p className="absolute inset-0 grid place-items-center p-5 text-center" role="status">
            {display === 'ended' ? 'The scheduled rehearsal performance has ended.' :
              display === 'unavailable' ? 'Playback is unavailable. Refresh to try again while the rehearsal is running.' :
                'Connecting to The Stage…'}
          </p>}
        {needsPlay && <button type="button" className="absolute bottom-5 left-5 rounded px-4 py-2 bg-card"
          onClick={() => requestContinue.current?.()}>Start playback</button>}
      </div>
    </div>
  )
}
