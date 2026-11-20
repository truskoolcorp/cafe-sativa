export type StageProgramState =
  | 'preview'
  | 'scheduled'
  | 'premiere'
  | 'live'
  | 'interrupted'
  | 'ended'
  | 'replay_processing'
  | 'replay'

export type StageProgramCta = Readonly<{
  id: string
  kind: 'artist' | 'music' | 'product' | 'event' | 'membership'
  label: string
  destination?: string
  verification: 'verified' | 'held'
  verificationEvidence?: string
  heldReason?: string
}>

export type StageProgram = Readonly<{
  id: string
  slug: string
  title: string
  subtitle: string
  performer: string
  format: 'concert' | 'comedy' | 'fashion' | 'spoken_word' | 'interview' | 'live_event'
  state: StageProgramState
  prerecorded: boolean
  media: Readonly<{
    video: string
    poster: string
    accessibleLabel: string
  }>
  lobby: Readonly<{
    startsAt?: string
    accessibility: string
    chatRules: readonly string[]
  }>
  interaction: Readonly<{
    mode: 'local_rehearsal' | 'moderated_live' | 'unavailable'
    reactions: readonly string[]
  }>
  ctas: readonly StageProgramCta[]
  replay: Readonly<{
    status: 'not_started' | 'processing' | 'ready' | 'held'
    href?: string
  }>
  disclosure: string
}>

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validStageProgram(program: StageProgram) {
  if (!idPattern.test(program.id) || !idPattern.test(program.slug)) return false
  if (!program.title.trim() || !program.performer.trim() || !program.media.accessibleLabel.trim()) return false
  if (!program.media.video.startsWith('/') || !program.media.poster.startsWith('/')) return false
  if (program.state === 'live' && program.prerecorded) return false
  if (program.state === 'premiere' && !program.prerecorded) return false
  if (program.interaction.mode === 'moderated_live' && program.state === 'preview') return false
  return program.ctas.every(validStageProgramCta)
}

export function validStageProgramCta(cta: StageProgramCta) {
  if (!idPattern.test(cta.id) || !cta.label.trim()) return false
  if (cta.verification === 'held') return !cta.destination && Boolean(cta.heldReason?.trim())
  if (!cta.destination || !cta.verificationEvidence?.trim()) return false
  try {
    return new URL(cta.destination).protocol === 'https:'
  } catch {
    return false
  }
}

export function stageProgramStatusLabel(program: StageProgram) {
  if (program.state === 'preview') return 'Private canary preview'
  if (program.state === 'scheduled') return 'Scheduled'
  if (program.state === 'premiere') return 'Premiere now'
  if (program.state === 'live') return 'Live now'
  if (program.state === 'interrupted') return 'Temporarily interrupted'
  if (program.state === 'ended') return 'Ended'
  if (program.state === 'replay_processing') return 'Replay processing'
  return 'Replay available'
}
