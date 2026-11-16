import { createHash } from 'node:crypto'

// Reviewable drafts. Canon snapshots bind a proposal; live checks still govern approval/rendering.
const laviche = { id: 'laviche-fea', name: 'Laviche', assetId: 'f5a66c99-5547-4d41-a774-1557f714f379', sha256: '31534f69cd04ec5bc4aa1be367fcdb6ef95590f190b3ca5e3e91d4fa69d7baee', voiceId: 'oNYzGfXKQJfjG1yEuJe9' }
const ahnika = { id: 'ahnika-merlot', name: 'Ahnika', assetId: '844906f1-7aae-4f65-a815-2fb374a27095', sha256: '5b9c6065df490fa4ef5796ea89faec4550dc2c13ac850d7475859b00c7af35d6', voiceId: 'v0r5L5uDA6ocN9hjTPYK' }
const keith = { id: 'keith', name: 'Keith', assetId: '8d0020f0-b7a0-4ab7-9c10-1d2f4cd78813', sha256: '992194fc9d66a8d9cc9bbc29c1c5da96dd54a5c9baed1548b34a2bbbc7f54ea2', voiceId: '1ADiGshU4crZd55MCmm6' }

export const EPISODE_BRIEFS = [
  {
    id: 'welcome-to-the-virtual-bar-v1', title: 'Welcome to the virtual Café Sativa bar', room: 'bar',
    roomAssetId: 'f493531a-c7e0-4e89-afbb-f2095b914a63', roomSha256: 'b6ae58d3151e7b93bd03f2dc55bae1424c03f8307c67dc9affb88fd0831720a9',
    cast: [laviche],
    lines: [{ speaker: laviche.id, text: 'Welcome to the virtual Café Sativa bar. I’m Laviche. This is a look at the vision we’re building: music, art, and room for a good conversation. Our future physical venue is planned for Tenerife in 2027, with the opening date still to be confirmed. For now, explore the venue online. Sip. Smoke. Vibe.' }],
    caption: 'Meet Laviche and explore the virtual Café Sativa bar. Physical venue planned for Tenerife in 2027; opening date to be confirmed.',
  },
  {
    id: 'stage-first-look-ahnika-v1', title: 'Ahnika introduces the virtual Stage', room: 'stage',
    roomAssetId: 'a5baf1c7-a101-40c4-9d5a-c5a9ecf3ef2b', roomSha256: 'b819952022d5147e75fa3558abbbe424396631957790d9f2d4ff92d3b364373c',
    cast: [ahnika],
    lines: [{ speaker: ahnika.id, text: 'I’m Ahnika. Welcome to the virtual Café Sativa Stage. The vision brings music, spoken word, and comedy into an intimate setting. Three-minute open-mic spots are part of the planned format. Take a look around, and watch for confirmed programming on the events page. This preview doesn’t announce a performance or open reservations.' }],
    caption: 'Explore the virtual Stage with Ahnika. Performance dates and appearances will be announced when confirmed.',
  },
  {
    id: 'at-the-table-introduction-v1', title: 'Keith and Laviche introduce At the Table', room: 'community',
    roomAssetId: 'd5d87b86-bf51-4e7c-90f8-936d10f83627', roomSha256: '42bdb1c1072c2ec396018e007b6d8df1f0f055162b87cb91f0004d4fd4f7ebeb',
    cast: [keith, laviche],
    lines: [
      { speaker: keith.id, text: 'At the Table starts with a simple idea: make room for a real conversation. Here at virtual Café Sativa, the long table is part of that vision.' },
      { speaker: laviche.id, text: 'Stories, different perspectives, and space to listen. Keith and I are part of the planned At the Table format. This is an introduction to the concept; session dates and guest appearances are still to be confirmed.' },
      { speaker: keith.id, text: 'Explore the virtual venue, and check the events page for confirmed sessions. We’ll see you at the table when the program is ready.' },
    ],
    caption: 'Keith and Laviche introduce the At the Table vision. This concept preview does not announce a live session or guest appearance.',
  },
].map(brief => ({ ...brief, format: '16:9', productionNotes: 'Preserve exact approved room, identities and source wardrobe. No new objects, guests, products, logos or music. An approved composite keyframe and final clip review are required before release. Do not use Chef V.', releaseAt: null }))

export type EpisodeBrief = typeof EPISODE_BRIEFS[number]
export const episodeHash = (brief: EpisodeBrief) => createHash('sha256').update(JSON.stringify(brief)).digest('hex')

export function episodeCanonMatches(brief: EpisodeBrief, characters: any[], room: any) {
  return Boolean(room && room.id === brief.roomAssetId && room.sha256 === brief.roomSha256 && room.subject === brief.room &&
    room.active && room.approved_by && room.approved_at && brief.cast.every(actor => {
      const current = characters.find(character => character.id === actor.id)
      return current?.production_ready === true && current.primary_asset_id === actor.assetId && current.sha256 === actor.sha256 &&
        current.rights_status === 'approved' && current.voice_status === 'canonical' && current.voice_id === actor.voiceId
    }))
}
