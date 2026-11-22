// The Spotify catalog identifies this specific single by Ahnika Merlot.
// The deployed link requires a separate exact-destination release approval.
export const AHNIKA_ALREADY_GONE_SPOTIFY = 'https://open.spotify.com/track/5GrVWG25UDXuOyOBjxX0jX'
export const AHNIKA_TRACK_CUE_OFFSET_MS = 75_000

export function ahnikaTrackCta(approvedUrl: string | undefined, kickoff: number, end: number) {
  const showAt = kickoff + AHNIKA_TRACK_CUE_OFFSET_MS
  if (approvedUrl !== AHNIKA_ALREADY_GONE_SPOTIFY ||
      !Number.isFinite(kickoff) || !Number.isFinite(end) || showAt >= end) return null
  return { url: AHNIKA_ALREADY_GONE_SPOTIFY, showAt }
}
