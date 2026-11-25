/** Scope Zaria releases independently of other Café Sativa hosts. */
export const ZARIA_PORTRAIT = {
  id: '473df9fd-b48c-4f01-a89a-499de631b954',
  sha256: 'ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca',
} as const
export const ZARIA_VOICE = { id: '5zneNR4v1Uw5AjIZ9Un4', model: 'eleven_v4' } as const
export const zariaChatEnabled = () => process.env.NEXT_PUBLIC_CS_ZARIA_GALLERY_CHAT === 'true'
export const zariaPortraitEnabled = () => process.env.CS_ZARIA_GALLERY_PORTRAIT === 'true'

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
