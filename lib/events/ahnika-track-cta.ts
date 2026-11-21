// The Spotify catalog identifies this specific single by Ahnika Merlot.
// The deployed link requires a separate exact-destination release approval.
export const AHNIKA_ALREADY_GONE_SPOTIFY = 'https://open.spotify.com/track/5GrVWG25UDXuOyOBjxX0jX'

export function ahnikaTrackCta(approvedUrl: string | undefined, now: number, doorsOpenAt: number) {
  if (approvedUrl !== AHNIKA_ALREADY_GONE_SPOTIFY) return null
  if (!Number.isFinite(now) || !Number.isFinite(doorsOpenAt) || now < doorsOpenAt) return null
  return AHNIKA_ALREADY_GONE_SPOTIFY
}
