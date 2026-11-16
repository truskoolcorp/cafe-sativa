export type PodcastVideo = { id: string; title: string; publishedAt: string }

/** Read only a configured show playlist, never a channel's unrelated uploads. */
export function newestPlaylistVideo(xml: string, now = Date.now()): PodcastVideo | null {
  if (xml.length > 1_000_000) return null
  const text = (entry: string, tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(entry)?.[1]?.trim() || ''
  const items: PodcastVideo[] = []
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const id = text(match[1], 'yt:videoId'), publishedAt = text(match[1], 'published')
    const date = Date.parse(publishedAt)
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || !Number.isFinite(date) || date > now) continue
    const title = text(match[1], 'title').replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    items.push({ id, title: title || 'What Are You Smoking?', publishedAt })
  }
  return items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id))[0] || null
}

export async function getLatestPodcastVideo(): Promise<PodcastVideo | null> {
  const playlist = process.env.CAFE_SATIVA_SMOKING_PLAYLIST_ID
  if (!playlist || !/^PL[A-Za-z0-9_-]{10,100}$/.test(playlist)) return null
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlist)}`, {
      next: { revalidate: 300 }, redirect: 'error', signal: AbortSignal.timeout(5000),
    })
    if (!response.ok || !/xml/.test(response.headers.get('content-type') || '')) return null
    return newestPlaylistVideo(await response.text())
  } catch { return null }
}
