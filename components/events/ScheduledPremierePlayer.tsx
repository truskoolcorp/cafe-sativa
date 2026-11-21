'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { scheduledPlayback } from '@/lib/events/scheduled-playback'

export default function ScheduledPremierePlayer({ src, startsAt, durationMs, serverNow }: {
  src: string
  startsAt: string
  durationMs: number
  serverNow: number
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [ended, setEnded] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const player = ref.current
    if (!player || ended || failed) return
    const mounted = performance.now()
    let attempted = false
    let active = true
    function sync() {
      if (!player || !active) return
      const result = scheduledPlayback(startsAt, durationMs, serverNow + performance.now() - mounted)
      if (result.phase === 'ended') { player.pause(); setEnded(true); return }
      if (result.phase !== 'premiere' || !player.readyState) return
      if (Math.abs(player.currentTime - result.position) > 2) player.currentTime = result.position
      if (!attempted) {
        attempted = true
        void player.play().catch(() => { if (active) setBlocked(true) })
      }
    }
    const timer = window.setInterval(sync, 500)
    player.addEventListener('loadedmetadata', sync)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      active = false
      window.clearInterval(timer)
      player.removeEventListener('loadedmetadata', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [src, startsAt, durationMs, serverNow, ended, failed])

  if (ended) return <p role="status">This premiere has ended. <Link href="/vip/recordings" className="text-primary underline">Visit the VIP replay archive</Link>.</p>
  if (failed) return <p role="status">Playback is temporarily unavailable. <a href="/events/ahnika-already-gone" className="text-primary underline">Reload to rejoin</a>.</p>
  return (
    <section aria-label="Scheduled premiere">
      <video ref={ref} className="pointer-events-none aspect-video w-full rounded-xl bg-black"
        muted={muted} playsInline preload="metadata" disablePictureInPicture onError={() => setFailed(true)}
        src={src} aria-label="Ahnika Merlot performing Already Gone" />
      <button type="button" className="mt-2 text-primary underline" onClick={() => {
        if (ref.current) ref.current.muted = !muted
        setMuted(!muted)
      }}>{muted ? 'Enable sound' : 'Mute sound'}</button>
      {blocked && <button type="button" className="ml-4 text-primary underline" onClick={() => {
        void ref.current?.play().then(() => setBlocked(false), () => setBlocked(true))
      }}>Join playback</button>}
    </section>
  )
}
