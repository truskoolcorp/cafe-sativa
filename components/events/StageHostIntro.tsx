'use client'

import { useEffect, useRef, useState } from 'react'
import { stageHostIntroPosition, type StageHostIntroAsset } from '@/lib/events/stage-host-intro'
import { readStageSound, readStageVolume, writeStageSound } from '@/lib/events/stage-sound'
import StageSoundToggle from './StageSoundToggle'

export default function StageHostIntro({ asset, kickoff, now, onUnavailable }: {
  asset: StageHostIntroAsset; kickoff: number; now: () => number; onUnavailable: () => void
}) {
  const player = useRef<HTMLVideoElement>(null)
  const [sound, setSound] = useState(false)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const video = player.current
    if (!video) return
    let active = true
    // Do not sit on a spinner for the opening line if the package will not load.
    const timeout = window.setTimeout(onUnavailable, 2400)
    const seek = () => {
      const position = stageHostIntroPosition(kickoff, now(), video.duration)
      if (position === null) return false
      if (Math.abs(position - video.currentTime) > 0.25) video.currentTime = position
      return true
    }
    const play = async () => {
      if (!seek()) { onUnavailable(); return }
      video.volume = readStageVolume() / 100
      video.muted = !readStageSound()
      try { await video.play() } catch {
        if (!active) return
        video.muted = true
        try { await video.play() } catch { if (active) onUnavailable(); return }
      }
      if (!active) return
      if (!seek()) { onUnavailable(); return }
      setSound(!video.muted)
    }
    const onPlaying = () => { window.clearTimeout(timeout); setPlaying(true) }
    video.addEventListener('playing', onPlaying)
    video.addEventListener('loadedmetadata', play, { once: true })
    if (video.readyState >= 1) {
      video.removeEventListener('loadedmetadata', play)
      void play()
    }
    return () => {
      active = false
      window.clearTimeout(timeout)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('loadedmetadata', play)
      video.pause()
    }
  }, [kickoff, now, onUnavailable])

  return (
    <div className="absolute inset-0">
      <video ref={player} playsInline preload="auto" src={asset.video} aria-label="Laviche welcomes the audience to The Stage"
        className={`size-full object-contain ${playing ? 'opacity-100' : 'opacity-0'}`} onError={onUnavailable}>
        <track kind="captions" src={asset.captions} srcLang="en" label="English" default onError={onUnavailable} />
      </video>
      {playing && <div className="absolute right-3 top-3 bg-black/80 text-white" data-stage-sound-control>
        <StageSoundToggle on={sound} toggle={() => {
          if (!player.current) return
          player.current.muted = sound
          setSound(!sound)
          writeStageSound(!sound)
        }} />
      </div>}
    </div>
  )
}
