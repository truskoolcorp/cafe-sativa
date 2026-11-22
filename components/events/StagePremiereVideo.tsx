'use client'

import { useEffect, useRef, useState } from 'react'
import { MIN_STAGE_VOLUME, readStageSound, readStageVolume, writeStageSound, writeStageVolume } from '@/lib/events/stage-sound'
import StageSoundToggle from './StageSoundToggle'

export default function StagePremiereVideo({ src, label, kickoff, serverNow, poster }: {
  src: string; label: string; kickoff?: number; serverNow?: number; poster?: string
}) {
  const [enabled, setEnabled] = useState(false)
  const [failed, setFailed] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const hydrated = useRef(false)
  const synchronized = useRef(false)
  const anchoredAt = useRef<number | null>(null)

  useEffect(() => {
    const on = readStageSound()
    if (video.current) {
      video.current.volume = readStageVolume() / 100
      video.current.muted = !on
    }
    anchoredAt.current = performance.now()
    setEnabled(on)
    hydrated.current = true
  }, [])

  function toggleSound() {
    const player = video.current
    if (!player) return
    player.muted = enabled
    if (!enabled && player.volume === 0) player.volume = readStageVolume() / 100
    setEnabled(!enabled)
    writeStageSound(!enabled)
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <StageSoundToggle on={enabled} toggle={toggleSound} />
      </div>
      <video ref={video} className="aspect-video w-full rounded-xl bg-black"
        controls playsInline muted={!enabled} preload="metadata" src={src} poster={poster} aria-label={label}
        onPlaying={event => {
          const player = event.currentTarget
          if (synchronized.current || kickoff === undefined || serverNow === undefined ||
              anchoredAt.current === null || !Number.isFinite(player.duration)) return
          synchronized.current = true
          const elapsed = (serverNow + performance.now() - anchoredAt.current - kickoff) / 1000
          if (elapsed > player.currentTime) player.currentTime = Math.min(elapsed, Math.max(0, player.duration - 0.1))
        }}
        onError={() => setFailed(true)}
        onVolumeChange={event => {
          if (!hydrated.current) return
          const player = event.currentTarget
          const on = !player.muted && player.volume > 0
          if (player.volume > 0) writeStageVolume(Math.max(MIN_STAGE_VOLUME, Math.round(player.volume * 100)))
          setEnabled(on)
          writeStageSound(on)
        }} />
      {failed && <p role="status" className="text-sm text-muted-foreground">Playback is temporarily unavailable. Refresh to try again while the premiere is still running.</p>}
    </div>
  )
}
