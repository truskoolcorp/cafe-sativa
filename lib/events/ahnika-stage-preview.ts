export const AHNIKA_STAGE_PREVIEW_BRANCH = 'feat/ahnika-stage-canary-20261120'

export function canPreviewAhnikaStage(env: Record<string, string | undefined>) {
  return env.VERCEL_ENV === 'preview'
    && env.VERCEL_GIT_COMMIT_REF === AHNIKA_STAGE_PREVIEW_BRANCH
}

export const AHNIKA_STAGE_CANARY = Object.freeze({
  title: 'Ahnika Merlot — Already Gone',
  subtitle: 'An intimate acoustic set on The Stage',
  disclosure:
    'This video and its edits include AI-assisted production under Tru Skool Entertainment International Corp.’s creative direction.',
})
