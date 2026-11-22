'use client'

import { useEffect, useRef, useState } from 'react'
import { MIN_STAGE_VOLUME, readStageSound, readStageVolume, writeStageSound, writeStageVolume } from '@/lib/events/stage-sound'
import { shouldStartScheduledStage, startScheduledStage } from '@/lib/events/stage-player-start'
import StageSoundToggle from './StageSoundToggle'

export default function StagePremiereVideo({ src, label, kickoff, serverNow }: {
  src: string; label: string; kickoff?: number; serverNow?: number
}) {
  const [enabled, setEnabled] = useState(false)
  const [failed, setFailed] = useState(false)
  const [needsTap, setNeedsTap] = useState(false)
  const [needsAudioActivation, setNeedsAudioActivation] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const hydrated = useRef(false)
  const synchronized = useRef(false)
  const anchoredAt = useRef<number | null>(null)
  const fallbackMute = useRef(false)
  const scheduled = shouldStartScheduledStage(kickoff, serverNow)

  useEffect(() => {
    let active = true
    const player = video.current
    const on = readStageSound()
    fallbackMute.current = false
    synchronized.current = false
    setNeedsTap(false)
    setNeedsAudioActivation(false)
    setFailed(false)
    if (player) {
      player.volume = readStageVolume() / 100
      player.muted = !on
    }
    anchoredAt.current = performance.now()
    setEnabled(on)
    hydrated.current = true
    if (scheduled && player) {
      void startScheduledStage(player, () => active, () => {
        fallbackMute.current = true
        setNeedsAudioActivation(true)
        setEnabled(false)
      }).then(result => { if (active && result === 'needs-tap') setNeedsTap(true) })
    }
    return () => { active = false }
  }, [src, kickoff, scheduled])

  function toggleSound() {
    const player = video.current
    if (!player) return
    fallbackMute.current = false
    setNeedsAudioActivation(false)
    player.muted = enabled
    if (!enabled && player.volume === 0) player.volume = readStageVolume() / 100
    setEnabled(!enabled)
    writeStageSound(!enabled)
  }

  async function startWithTap() {
    const player = video.current
    if (!player) return
    try { await player.play(); setNeedsTap(false) }
    catch { setFailed(true) }
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <StageSoundToggle on={enabled} needsActivation={needsAudioActivation} toggle={toggleSound} />
      </div>
      <video ref={video} className="aspect-video w-full rounded-xl bg-black"
        controls playsInline muted={!enabled} preload="metadata" src={src} aria-label={label}
        onPlaying={event => {
          const player = event.currentTarget
          setNeedsTap(false)
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
          if (fallbackMute.current && player.muted) return
          fallbackMute.current = false
          setNeedsAudioActivation(false)
          writeStageSound(on)
        }} />
      {needsTap && !failed && <button type="button" onClick={startWithTap} className="text-sm text-primary underline">Start playback</button>}
      {failed && <p role="status" className="text-sm text-muted-foreground">Playback is temporarily unavailable. Refresh to try again while the premiere is still running.</p>}
    </div>
  )
}
