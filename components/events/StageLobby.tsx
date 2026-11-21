'use client'

import { useEffect, useRef, useState } from 'react'
import { stageLobbyPhase, STAGE_INTRO_LEAD_MS } from '@/lib/events/stage-lobby'

type Props = {
  startsAt: string
  serverNow: number
  poster: string
  loop: string
  intro: string
}

export default function StageLobby({ startsAt, serverNow, poster, loop, intro }: Props) {
  const [phase, setPhase] = useState(() => stageLobbyPhase(startsAt, serverNow))
  const [motion, setMotion] = useState(false)
  const [failed, setFailed] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

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
      }
    }
    tick()
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [startsAt, serverNow])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setMotion(!preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  const showMotion = motion && !failed && (phase === 'lobby' || phase === 'intro')
  useEffect(() => {
    if (!showMotion) return
    let mounted = true
    void video.current?.play().catch(() => { if (mounted) setMotion(false) })
    return () => { mounted = false }
  }, [showMotion])

  return (
    <section aria-labelledby="stage-lobby-heading" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-[3/2] min-h-48 bg-black">
        {/* Decorative venue imagery: the schedule and welcome are available as text below. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt="" width={1536} height={1024} className="absolute inset-0 size-full object-contain" />
        {showMotion && (
          <video ref={video} src={loop} poster={poster} muted loop playsInline preload="metadata"
            aria-hidden="true" className="pointer-events-none absolute inset-0 size-full object-contain"
            onError={() => setFailed(true)} />
        )}
      </div>
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="stage-lobby-heading" className="font-heading text-2xl font-semibold">Premiere lobby</h2>
          {!failed && (phase === 'lobby' || phase === 'intro') && (
            <button type="button" className="text-sm text-primary underline underline-offset-4"
              onClick={() => setMotion(current => !current)}>
              {showMotion ? 'Pause Stage ambience' : 'Play Stage ambience'}
            </button>
          )}
        </div>
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
