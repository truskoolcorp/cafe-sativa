import { HIT_EM_PREMIERE, type PublicPremiere } from '@/lib/events/hit-em-premiere'

// This fixture is for the single protected PR deployment, not a publication
// override. Production, local, and unrelated preview deployments fail closed.
export function canPreviewHitEm(env: Record<string, string | undefined>) {
  return env.VERCEL_ENV === 'preview'
    && env.VERCEL_GIT_COMMIT_REF === 'feat/hit-em-public-premiere-20261108'
}

export function hitEmPreviewFixture(): PublicPremiere {
  return {
    state: 'ready',
    status: 'scheduled',
    title: HIT_EM_PREMIERE.title,
    startsAt: HIT_EM_PREMIERE.startsAt,
    description: 'Join the Hit Em premiere gathering on Wednesday, November 11, 2026 at midnight America/Chicago (00:00 CST). Watch the music video and join its YouTube live chat. The video is publicly available on YouTube; posting in chat requires YouTube sign-in. No Café Sativa account or ticket is required.',
  }
}
