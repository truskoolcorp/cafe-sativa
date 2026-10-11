export const CONTENT_POLICY = {
  version: '2026-10-11',
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
    model: 'gen4.5', promptImage: venue.url, ratio: '1280:720', duration: 5,
    // Existing drafts may request movement. Until a new take passes canonical QA,
    // do not reveal unseen geometry or synthesize portrait framing from landscape masters.
    promptText: 'A single uninterrupted locked-off shot of this exact empty virtual Café Sativa venue. The camera stays completely stationary throughout. Preserve the reference composition, exact room geometry, furnishings, materials, artwork and lighting. No cuts, transitions, camera movement, new viewpoints, added people, altered signage or new objects.',
  }
}

// Venue-only templates deliberately avoid character synthesis until approved composite keyframes exist.
export const WEEKLY_SLOTS = [
  { weekday: 1, room: 'main-lounge', title: 'Inside the virtual lounge', action: 'A locked-off shot preserving the exact approved empty room, with no camera movement.', caption: 'Step inside the virtual Café Sativa lounge. Music, art, and conversation shape the atmosphere we are building toward our future physical venue. Sip. Smoke. Vibe.' },
  { weekday: 2, room: 'stage', title: 'The virtual Stage', action: 'A locked-off shot preserving the exact approved empty room, with no camera movement.', caption: 'Explore the approved virtual Café Sativa Stage concept. Music, spoken word and comedy shape the programming vision; appearances and performance dates will be announced when confirmed.' },
  { weekday: 3, room: 'bar', title: 'A moment at the virtual bar', action: 'A locked-off shot preserving the exact approved empty room, with no camera movement.', caption: 'A preview of the virtual Café Sativa bar: warm light, thoughtful details, and room for a good conversation. Explore the vision for our future venue online.' },
  { weekday: 4, room: 'kitchen', title: 'Inside the virtual Kitchen', action: 'A locked-off shot preserving the exact approved empty room, with no camera movement.', caption: 'Explore the virtual Café Sativa Kitchen and its fusion-cuisine programming vision. This room preview does not announce a guest chef, an available menu or a booked class.' },
  { weekday: 5, room: 'gallery', title: 'Art in the virtual venue', action: 'A locked-off shot preserving the exact approved empty room, with no camera movement.', caption: 'Art belongs in the conversation. Explore the virtual Café Sativa gallery and the atmosphere inspiring our future physical venue.' },
  { weekday: 6, room: 'cigar_lounge', title: 'The virtual Cigar Lounge', action: 'A locked-off shot preserving the exact approved empty room, with no camera movement.', caption: 'The virtual Café Sativa Cigar Lounge: a setting for thoughtful conversation and planned guided formats. This preview describes the room vision, not a booked tasting or available product offer.' },
  { weekday: 0, room: 'community', title: 'A place for At the Table', action: 'A locked-off shot preserving the exact approved empty room, with no camera movement.', caption: 'Explore the approved virtual long-table setting for Café Sativa’s At the Table vision. A place for story and conversation, with session dates and appearances to be confirmed.' },
] as const

export function localDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONTENT_POLICY.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function dueSlots(now: Date) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: CONTENT_POLICY.timezone, weekday: 'short' }).format(now)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  return WEEKLY_SLOTS.filter(slot => slot.weekday === day)
}

