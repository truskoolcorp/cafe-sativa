/** Exact owner-requested private take, not video or publication authority. */
export const stageLavicheSpeech = Object.freeze({
  key: 'stage-ahnika-laviche-intro-v1',
  authorizationRef: 'keith-2026-11-22-one-private-stage-mc-take-included-only',
  characterId: 'laviche-fea',
  voiceId: 'oNYzGfXKQJfjG1yEuJe9',
  modelId: 'eleven_v4',
  script: 'Good evening, Café Sativa. I’m Laviche. Find your seat, get comfortable, and say hello in the chat. Tonight, we’re keeping it intimate: one voice, one guitar, and a song called “Already Gone.” Please welcome Ahnika Merlot to The Stage.',
  scriptSha256: '6a9f74536b2dae85f47aa4c4d74ca12b77b058dc5f711e14f5887676da79fc1e',
  portraitSha256: '31534f69cd04ec5bc4aa1be367fcdb6ef95590f190b3ca5e3e91d4fa69d7baee',
  expiresAt: Date.parse('2026-11-25T06:00:00Z'),
  maxDurationSeconds: 21.8,
})
export const stageLavichePortraitId = 'f5a66c99-5547-4d41-a774-1557f714f379'

export function stageLavicheScope(canonicalRevision: string | undefined) {
  if (!canonicalRevision || !/^[a-f0-9]{64}$/.test(canonicalRevision)) return null
  return Object.freeze({ ...stageLavicheSpeech, canonicalRevision })
}
