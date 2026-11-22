import { loungeGuestCode } from './lounge-speaker'

export function loungeMentionHandles(names: ReadonlyMap<string, string>, roomId: string) {
  const handles = new Map([...names].map(([id, name]) => [id,
    name.normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || `Guest-${loungeGuestCode(roomId, id)}`,
  ]))
  const counts = new Map<string, number>()
  for (const handle of handles.values()) counts.set(handle.toLowerCase(), (counts.get(handle.toLowerCase()) ?? 0) + 1)
  for (const [id, handle] of handles) {
    if ((counts.get(handle.toLowerCase()) ?? 0) > 1) handles.set(id, `${handle}-${loungeGuestCode(roomId, id)}`)
  }
  return handles
}

export function loungeMentionQuery(text: string) {
  return /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text)?.[1] ?? null
}

export function insertLoungeMention(text: string, caret: number, handle: string) {
  caret = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, caret)
  const query = loungeMentionQuery(before)
  const start = query === null ? caret : caret - query.length - 1
  const prefix = text.slice(0, start)
  const insert = `${prefix && !/\s$/.test(prefix) ? ' ' : ''}@${handle} `
  const suffix = query === null ? text.slice(caret) : text.slice(caret).replace(/^[\p{L}\p{N}_-]*/u, '')
  return { text: prefix + insert + suffix.replace(/^ /, ''), caret: start + insert.length }
}

export function loungeMentionParts(text: string) {
  const parts: { text: string; handle?: string }[] = []
  let offset = 0
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_@.\/:\-])@([\p{L}\p{N}_-]+)(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}])/gu)) {
    const start = match.index! + match[1].length
    if (start > offset) parts.push({ text: text.slice(offset, start) })
    parts.push({ text: `@${match[2]}`, handle: match[2].toLowerCase() })
    offset = start + match[2].length + 1
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) })
  return parts
}
