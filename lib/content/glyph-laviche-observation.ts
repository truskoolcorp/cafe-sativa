import 'server-only'
import { readGlyph } from './glyph-live'
import { readBoundedPublicChatJson } from './public-chat-readiness-resources'

const CHARACTER = 'laviche-fea'
const ROW_KEYS = [
  'id', 'name', 'primary_asset_id', 'sha256', 'rights_status', 'voice_id',
  'voice_status', 'approved_reference_count', 'portrait_available', 'blockers',
  'canonical_gaps', 'requires_rights_consent', 'canonical_context',
  'profile_version', 'production_ready',
]
type Row = Record<string, unknown>
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('unavailable')
  return value as Row
}
function exact(value: Row, keys: string[]): void {
  if (Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw Error('unavailable')
}
const nullableString = (value: unknown) => value === null || typeof value === 'string'
const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string')
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Fixed private JSON observation only. No caller-selected ID, query or origin.
 * Keep the full producer row and existing Cafe portrait enrichment for its private
 * pin. verifiedAt remains upstream observation completion, never a new timestamp
 * or a claim about when the profile was generated or where its prose originated.
 */
export async function liveLavicheCanonicalObservation(signal: AbortSignal) {
  try {
    if (signal.aborted) throw Error('unavailable')
    const response = await readGlyph('?observation=laviche-fea', signal)
    const source = record(await readBoundedPublicChatJson(response, signal))
    exact(source, ['verifiedAt', 'source', 'studioUrl', 'live', 'characters'])
    if (source.live !== true || source.source !== 'GLYPH live canonical registry' || source.studioUrl !== 'https://studio.truskool.net/' || typeof source.verifiedAt !== 'string' || !Array.isArray(source.characters) || source.characters.length !== 1) throw Error('unavailable')
    const observed = Date.parse(source.verifiedAt)
    if (!Number.isSafeInteger(observed) || new Date(observed).toISOString() !== source.verifiedAt) throw Error('unavailable')
    const row = record(source.characters[0])
    exact(row, ROW_KEYS)
    if (row.id !== CHARACTER || typeof row.name !== 'string' || !nullableString(row.primary_asset_id) || !nullableString(row.sha256) || typeof row.rights_status !== 'string' || !nullableString(row.voice_id) || !nullableString(row.voice_status) || !count(row.approved_reference_count) || typeof row.portrait_available !== 'boolean' || !strings(row.blockers) || !strings(row.canonical_gaps) || typeof row.requires_rights_consent !== 'boolean' || typeof row.canonical_context !== 'string' || !count(row.profile_version) || typeof row.production_ready !== 'boolean') throw Error('unavailable')
    // Match liveGlyphCharacters enrichment without filtering/projecting the row.
    const portrait_url = row.portrait_available && row.primary_asset_id
      ? `/api/content/glyph/portrait?characterId=${encodeURIComponent(CHARACTER)}&assetId=${encodeURIComponent(row.primary_asset_id as string)}`
      : null
    return { ...source, characters: [{ ...row, portrait_url }] }
  } catch { throw Error('unavailable') }
}
