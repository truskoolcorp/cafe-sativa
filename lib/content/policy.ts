export const CONTENT_POLICY = {
  version: '2026-10-07',
  monthlyBudgetCents: 2500,
  timezone: 'America/Chicago',
  venueStatus: 'virtual-first; future physical Tenerife venue',
  host: 'Laviche Cárdenas',
  instagram: '@cafesativainc',
  rules: [
    'Describe scenes as the virtual venue or a preview of the planned physical venue.',
    'Never invent an opening date, address, event, reservation, menu price, or personal visit.',
    'Use approved versioned venue keyframes; preserve layout, furniture, materials and lighting.',
    'Use approved character references and voices; preserve exact identity, proportions and wardrobe.',
    'Laviche has long black hair, an athletic petite build, no tattoos and no cigarette.',
    'Ultra photorealistic: natural skin texture, physically plausible light, motion and anatomy.',
    'Composite the actual approved logo in editing; never ask a model to redraw it.',
    'Reuse approved media before paying for a new generation. No automatic paid retries.',
  ],
} as const

export type CanonicalAsset = {
  id: string; kind: 'venue' | 'character' | 'logo'; subject: string
  url: string; sha256: string; version: string; approved_by: string | null
  approved_at: string | null; active: boolean
}

export function approvedAsset(asset: CanonicalAsset | null): boolean {
  if (!asset || !asset.active || !asset.approved_by || !asset.approved_at || !asset.version) return false
  try {
    const url = new URL(asset.url)
    return url.protocol === 'https:' && !url.username && !url.password && /^[a-f0-9]{64}$/.test(asset.sha256)
  } catch { return false }
}

export function compileShot(venue: CanonicalAsset, action: string) {
  if (!approvedAsset(venue) || venue.kind !== 'venue') throw new Error('Approved venue keyframe required')
  if (!action.trim() || action.length > 300) throw new Error('Invalid camera action')
  return {
    model: 'gen4.5', promptImage: venue.url, ratio: '720:1280', duration: 5,
    promptText: `Photorealistic live-action cinematography of this exact virtual Café Sativa venue. ${action.trim()} Preserve the exact room geometry, furnishings, materials and lighting of the reference. Natural motion and physically accurate shadows. No added people, no altered signage, no new objects.`,
  }
}

// Venue-only templates deliberately avoid character synthesis until approved composite keyframes exist.
export const WEEKLY_SLOTS = [
  { weekday: 1, room: 'main-lounge', title: 'Inside the virtual lounge', action: 'A gentle, steady camera push into the lounge.', caption: 'Step inside the virtual Café Sativa lounge. Music, art, and conversation shape the atmosphere we are building toward our future physical venue. Sip. Smoke. Vibe.' },
  { weekday: 3, room: 'bar', title: 'A moment at the virtual bar', action: 'A slow camera glide along the existing bar.', caption: 'A preview of the virtual Café Sativa bar: warm light, thoughtful details, and room for a good conversation. Explore the vision for our future venue online.' },
  { weekday: 5, room: 'gallery', title: 'Art in the virtual venue', action: 'A subtle camera move through the existing gallery.', caption: 'Art belongs in the conversation. Explore the virtual Café Sativa gallery and the atmosphere inspiring our future physical venue.' },
] as const

export function localDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONTENT_POLICY.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function dueSlots(now: Date) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: CONTENT_POLICY.timezone, weekday: 'short' }).format(now)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  return WEEKLY_SLOTS.filter(slot => slot.weekday === day)
}
