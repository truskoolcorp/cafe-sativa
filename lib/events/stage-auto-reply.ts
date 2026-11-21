type Host = 'ahnika' | 'laviche'
type Intent = 'start' | 'sound' | 'format' | 'replay'
type Facts = {
  startsAt: string
  format: 'scheduled-premiere' | 'live-stream'
  /** From the verified player mode, not a statement supplied by a viewer. */
  enableSoundControl: boolean
  /** Only true for a published, verified archive item. */
  vipReplayPublished: boolean
}

const questions: Readonly<Record<Intent, readonly string[]>> = {
  start: ['when does the show start', 'what time does the premiere start', 'what time is the show'],
  sound: ['how do i enable sound', 'how do i unmute the show', 'how do i turn on the sound'],
  format: ['is this live or prerecorded', 'is this show prerecorded', 'is the performance live'],
  replay: ['where can i watch the replay', 'is there a replay', 'where is the replay'],
}

export type StageAutoReplyDecision =
  | { action: 'handoff'; reason: 'disabled' | 'unverified' | 'not_supported' }
  | { action: 'eligible'; intent: Intent; text: string }

/** Eligibility only. This function never sends a message or calls a provider. */
export function decideStageAutoReply(input: {
  question: string
  host: Host
  facts: Facts | null
  enabled: boolean
  paused: boolean
}): StageAutoReplyDecision {
  if (!input.enabled || input.paused) return { action: 'handoff', reason: 'disabled' }
  if (!input.facts) return { action: 'handoff', reason: 'unverified' }
  const { facts } = input
  if (!input.question || input.question.length > 100 || /[\r\n]/.test(input.question)) {
    return { action: 'handoff', reason: 'not_supported' }
  }
  const question = input.question.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\?$/, '')
  const intent = (Object.keys(questions) as Intent[]).find(key => questions[key].includes(question))
  if (!intent) return { action: 'handoff', reason: 'not_supported' }
  let answer: string
  if (intent === 'start') {
    if (!Number.isFinite(Date.parse(facts.startsAt))) return { action: 'handoff', reason: 'unverified' }
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short',
    }).format(new Date(facts.startsAt))
    answer = `The show starts ${time} Central.`
  } else if (intent === 'sound') {
    if (!facts.enableSoundControl) return { action: 'handoff', reason: 'unverified' }
    answer = 'Select Enable sound below the player.'
  } else if (intent === 'format') {
    answer = facts.format === 'scheduled-premiere'
      ? 'The performance is prerecorded and starts at the scheduled premiere time. The audience chat is live.'
      : 'The performance is scheduled as a live stream. Check the player for its current status.'
  } else {
    if (!facts.vipReplayPublished) return { action: 'handoff', reason: 'unverified' }
    answer = 'The replay is in the VIP recordings archive for members with replay access.'
  }
  const intro = input.host === 'laviche' ? 'From the floor: ' : ''
  return { action: 'eligible', intent, text: intro + answer }
}
