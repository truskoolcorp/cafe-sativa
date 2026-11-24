export const artworkCreationMethods = [
  { value: 'no_ai', label: 'No AI used' },
  { value: 'ai_assisted', label: 'AI-assisted' },
  { value: 'primarily_ai_generated', label: 'Primarily AI-generated' },
] as const

export type ArtworkCreationMethod = (typeof artworkCreationMethods)[number]['value']

export const artworkCreationMethodEnabled = process.env.NEXT_PUBLIC_GALLERY_ARTWORK_METHOD === 'true'

export function isArtworkCreationMethod(value: unknown): value is ArtworkCreationMethod {
  return artworkCreationMethods.some((method) => method.value === value)
}

export function declaredAiArtworkLabel(value: unknown): string | null {
  if (value !== 'ai_assisted' && value !== 'primarily_ai_generated') return null
  return artworkCreationMethods.find((method) => method.value === value)?.label ?? null
}
