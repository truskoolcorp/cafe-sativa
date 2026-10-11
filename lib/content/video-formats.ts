// Editorial export defaults, selected by placement rather than platform name alone.
// These are our delivery presets, not claims about platform upload limits.
export const MASTER_VIDEO = { width: 1280, height: 720, ratio: '1280:720' } as const
export const VIDEO_FORMATS = {
  landscape: { width: 1280, height: 720 },
  feed: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  vertical: { width: 1080, height: 1920 },
} as const
export type VideoFormat = keyof typeof VIDEO_FORMATS
export function videoFormatFor(network: string, placement: 'feed' | 'reel' | 'story' | 'short' = 'feed'): VideoFormat {
  if (['reel', 'story', 'short'].includes(placement)) return 'vertical'
  if (['tiktok', 'snapchat'].includes(network)) return 'vertical'
  if (['facebook', 'threads', 'instagram'].includes(network)) return 'feed'
  if (['youtube', 'linkedin', 'twitter', 'x'].includes(network)) return 'landscape'
  throw new Error('Video placement needs a verified export preset')
}
export function preserveFrameFilter(format: VideoFormat) {
  const { width, height } = VIDEO_FORMATS[format]
  // Fit the whole source; never crop, stretch, track a guessed subject or invent pixels.
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x101010,setsar=1`
}
