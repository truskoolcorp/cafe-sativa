const SPEAKER_ACCENTS = [
  '#8fd9f2', '#a4e3b0', '#c1b5fb', '#f7b1d2', '#f5ba96', '#99e0d4',
  '#b6cbff', '#d6dd93', '#f6a9aa', '#a1c7ea', '#e5aceb', '#b8deb9',
] as const

function speakerHash(roomId: string, userId: string) {
  const key = `${roomId}:${userId}`
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193)
  }
  return hash >>> 0
}

export function loungeGuestCode(roomId: string, userId: string) {
  return speakerHash(roomId, userId).toString(36).padStart(6, '0').slice(-6).toUpperCase()
}

export function loungeDisplayName(name: string | null | undefined, roomId: string, userId: string) {
  const label = name?.trim().replace(/\s+/g, ' ')
  if (label && !label.includes('@') && !/^(member|guest|rehearsal guest)$/i.test(label)) return label
  return `Guest ${loungeGuestCode(roomId, userId)}`
}

export function loungeSpeakerAccent(roomId: string, userId: string) {
  return SPEAKER_ACCENTS[speakerHash(roomId, userId) % SPEAKER_ACCENTS.length]
}
