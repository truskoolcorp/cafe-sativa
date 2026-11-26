/** Scope Zaria releases independently of other Café Sativa hosts. */
export const ZARIA_PORTRAIT = {
  id: '473df9fd-b48c-4f01-a89a-499de631b954',
  sha256: 'ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca',
} as const
// The production route serves only the rights-checked, resized public derivative.
// The fixed URL also works from the isolated Preview, without publishing the master.
export const ZARIA_DISPLAY_PORTRAIT = 'https://www.cafe-sativa.com/api/gallery/zaria-portrait'
export const ZARIA_VOICE = { id: '5zneNR4v1Uw5AjIZ9Un4', model: 'eleven_v4' } as const
export const zariaChatEnabled = () => process.env.NEXT_PUBLIC_CS_ZARIA_GALLERY_CHAT === 'true'
export const zariaPortraitEnabled = () => process.env.CS_ZARIA_GALLERY_PORTRAIT === 'true'

export function zariaVoiceAgent(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CS_ZARIA_GALLERY_LIVE_VOICE !== 'true' ||
    env.NEXT_PUBLIC_CS_ZARIA_GALLERY_CHAT !== 'true' ||
    env.CS_ZARIA_LIVEKIT_VERIFIED_VOICE_ID !== ZARIA_VOICE.id ||
    env.CS_ZARIA_LIVEKIT_VERIFIED_VOICE_MODEL !== ZARIA_VOICE.model) return null
  const agent = env.CS_ZARIA_LIVEKIT_AGENT_NAME?.trim()
  if (agent !== 'cafe-sativa-zaria' || agent === env.CS_LIVEKIT_AGENT_NAME?.trim()) return null
  return agent
}

export function galleryWorkSlug(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) ? value : null
}

export function zariaGalleryHref(value?: string): string {
  const slug = galleryWorkSlug(value)
  return '/ask?host=zaria' + (slug ? '&work=' + slug : '')
}

export function approvedZariaPortrait(row: {id?:unknown; production_ready?:unknown; rights_status?:unknown; primary_asset_id?:unknown; sha256?:unknown} | undefined): boolean {
  return row?.id === 'zaria-solenne' && row.production_ready === true && row.rights_status === 'approved' &&
    row.primary_asset_id === ZARIA_PORTRAIT.id && row.sha256 === ZARIA_PORTRAIT.sha256
}

// Render generated chat as text; browse links are separate server-validated controls.
export function zariaChatDisplay(value: string): string {
  return value
    .replace(/!?\[([^\]\n]+)\]\([^\n)]+\)/g, '$1')
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, '')
    .replace(/[*\x60]/g, '')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .trim()
}
