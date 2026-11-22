import { STAGE_INTRO_LEAD_MS } from './stage-lobby'

export const AHNIKA_HOST_TRANSCRIPT = 'Good evening, Café Sativa. I’m Laviche. Find your seat, get comfortable, and say hello in the chat. Tonight, we’re keeping it intimate: one voice, one guitar, and a song called “Already Gone.” Please welcome Ahnika Merlot to The Stage.'

export type StageHostIntroAsset = Readonly<{
  video: string
  captions: string
  revealPoster: string
}>

// The operator sets this only after reviewing this exact, immutable public package.
// No URLs, external endpoints, or performance bytes can be supplied by this setting.
export function approvedAhnikaHostIntro(release: string | undefined): StageHostIntroAsset | undefined {
  if (!release || !/^[a-f0-9]{64}$/.test(release)) return undefined
  const root = `/stage-host-intros/ahnika-already-gone/${release}`
  return { video: `${root}/intro.mp4`, captions: `${root}/intro.en.vtt`, revealPoster: `${root}/reveal.webp` }
}

export function stageHostIntroPosition(kickoffMs: number, now: number, duration: number): number | null {
  const elapsed = (now - (kickoffMs - STAGE_INTRO_LEAD_MS)) / 1000
  const targetLength = STAGE_INTRO_LEAD_MS / 1000
  if (!Number.isFinite(elapsed) || !Number.isFinite(duration) || Math.abs(duration - targetLength) > 0.25) return null
  return elapsed >= 0 && elapsed < Math.min(duration, targetLength) ? elapsed : null
}
