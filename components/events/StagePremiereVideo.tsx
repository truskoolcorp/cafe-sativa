'use client'

import { useEffect, useRef, useState } from 'react'
import { MIN_STAGE_VOLUME, readStageSound, readStageVolume, writeStageSound, writeStageVolume } from '@/lib/events/stage-sound'
import StageSoundToggle from './StageSoundToggle'

export default function StagePremiereVideo({ src, label }: { src: string; label: string }) {
  const [enabled, setEnabled] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const hydrated = useRef(false)

  useEffect(() => {
    const on = readStageSound()
    if (video.current) {
      video.current.volume = readStageVolume() / 100
      video.current.muted = !on
    }
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
        controls playsInline muted={!enabled} preload="metadata" src={src} aria-label={label}
        onVolumeChange={event => {
          if (!hydrated.current) return
          const player = event.currentTarget
          const on = !player.muted && player.volume > 0
          if (player.volume > 0) writeStageVolume(Math.max(MIN_STAGE_VOLUME, Math.round(player.volume * 100)))
          setEnabled(on)
          writeStageSound(on)
        }} />
    </div>
  )
}
