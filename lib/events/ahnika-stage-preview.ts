import type { StageProgram } from './stage-program'

export const AHNIKA_STAGE_PREVIEW_BRANCH = 'feat/ahnika-stage-canary-20261120'

export function canPreviewAhnikaStage(env: Record<string, string | undefined>) {
  return env.VERCEL_ENV === 'preview'
    && env.VERCEL_GIT_COMMIT_REF === AHNIKA_STAGE_PREVIEW_BRANCH
}

export const AHNIKA_STAGE_CANARY = Object.freeze({
  id: 'ahnika-already-gone-canary',
  slug: 'ahnika-already-gone',
  title: 'Ahnika Merlot — Already Gone',
  subtitle: 'An intimate acoustic set on The Stage',
  performer: 'Ahnika Merlot',
  format: 'concert',
  state: 'preview',
  prerecorded: true,
  media: {
    video: '/api/preview/ahnika-stage?asset=video',
    poster: '/api/preview/ahnika-stage?asset=poster',
    accessibleLabel: 'Ahnika Merlot performing Already Gone on the Café Sativa Stage',
  },
  lobby: {
    startsAt: '2026-12-01T06:00:00.000Z', // December 1 at midnight in America/Chicago.
    accessibility: 'An intimate prerecorded acoustic performance in the warm, lounge-style Café Sativa Stage environment.',
    chatRules: ['Keep conversation welcoming.', 'Do not post private information.', 'Messages may be held or removed by a moderator.'],
  },
  interaction: { mode: 'local_rehearsal', reactions: ['Love it', 'Encore', 'Smooth'] },
  ctas: [{
    id: 'official-listening-destination',
    kind: 'music',
    label: 'Listen to Already Gone',
    verification: 'held',
    heldReason: 'No exact owner-approved artist or song destination is recorded in the approved launch package.',
  }],
  replay: { status: 'not_started' },
  disclosure:
    'This video and its edits include AI-assisted production under Tru Skool Entertainment International Corp.’s creative direction.',
} satisfies StageProgram)
