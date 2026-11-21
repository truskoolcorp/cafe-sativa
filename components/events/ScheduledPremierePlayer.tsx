'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

export default function ScheduledPremierePlayer({ src, endsAt, startsAt }: {
  src: string
  startsAt: string
  endsAt: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [ended, setEnded] = useState(() => Date.now() >= Date.parse(endsAt))
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    const player = video.current
    if (!player || ended) return
    const start = Date.parse(startsAt)
    const end = Date.parse(endsAt)
    function sync() {
      if (!player) return
      const now = Date.now()
      if (now >= end) { player.pause(); setEnded(true); return }
      if (!player.readyState) return
      const position = Math.max(0, (now - start) / 1000)
      if (Math.abs(player.currentTime - position) > 1.5) player.currentTime = position
      if (player.paused) void player.play().then(() => setBlocked(false), () => setBlocked(true))
    }
    player.addEventListener('loadedmetadata', sync)
    document.addEventListener('visibilitychange', sync)
    const timer = window.setInterval(sync, 1000)
    sync()
    return () => {
      window.clearInterval(timer)
      player.removeEventListener('loadedmetadata', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [endsAt, startsAt, ended, src])

  if (ended) return <p>This premiere has ended. <Link href="/vip/recordings" className="text-primary underline">Visit the VIP replay archive</Link>.</p>
  return (
    <section aria-label="Scheduled premiere">
      <video ref={video} className="pointer-events-none aspect-video w-full rounded-xl bg-black"
        muted={muted} playsInline preload="metadata" disablePictureInPicture
        src={src} aria-label="Ahnika Merlot performing Already Gone" />
      <button type="button" className="mt-2 text-primary underline" onClick={() => {
        if (video.current) video.current.muted = !muted
        setMuted(!muted)
      }}>{muted ? 'Enable sound' : 'Mute sound'}</button>
      {blocked && <button type="button" className="ml-4 text-primary underline" onClick={() => {
        void video.current?.play().then(() => setBlocked(false), () => setBlocked(true))
      }}>Join playback</button>}
    </section>
  )
}
