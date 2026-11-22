import { loungeGuestCode } from './lounge-speaker'

export function loungeMentionHandles(names: ReadonlyMap<string, string>, roomId: string) {
  const base = new Map([...names].map(([id, name]) => [id,
    name.normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || `guest-${loungeGuestCode(roomId, id)}`,
  ]))
  const used = new Map<string, number>()
  for (const name of base.values()) used.set(name.toLowerCase(), (used.get(name.toLowerCase()) ?? 0) + 1)
  return new Map([...base].map(([id, name]) => [id, (used.get(name.toLowerCase()) ?? 0) > 1
    ? `${name}-${loungeGuestCode(roomId, id)}` : name]))
}

export function loungeMentionParts(text: string) {
  const parts: { text: string; handle?: string }[] = []
  let after = 0
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_@.\/:\-])@([\p{L}\p{N}_-]+)(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}])/gu)) {
    const start = match.index! + match[1].length
    if (start > after) parts.push({ text: text.slice(after, start) })
    parts.push({ text: `@${match[2]}`, handle: match[2].toLowerCase() })
    after = start + match[2].length + 1
  }
  if (after < text.length) parts.push({ text: text.slice(after) })
  return parts
}

export function loungeMentionQuery(text: string) {
  return /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text)?.[1] ?? null
}
