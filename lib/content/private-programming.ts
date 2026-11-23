import { createAdminClient } from '@/lib/supabase/admin'
import { localDate } from '@/lib/content/policy'

type Database = ReturnType<typeof createAdminClient>
type Mode = 'automatic' | 'manual'
type Proposal = { id: string; title: string; status: string; proposed_month: string }
type Stage = 'existing_proposals' | 'catalog_inventory' | 'save_proposal' | 'concurrent_proposal'
export type PrivateProgrammingResult =
  | { status: 'created' | 'existing'; month: string; proposal: Proposal }
  | { status: 'empty_catalog'; month: string }

export class PrivateProgrammingError extends Error {
  constructor(public readonly stage: Stage) {
    super('Private programming planning failed at ' + stage)
    this.name = 'PrivateProgrammingError'
  }
}

const proposalFields = 'id,title,status,proposed_month'
const titlePrefix = 'Catalog spotlight: '

// The permanent key survives rejection and owner revisions. The existing unique
// key and active music/month index arbitrate concurrent inserts; never upsert.
async function findExisting(db: Database, month: string, key: string) {
  return db.from('cs_programming_proposals').select(proposalFields)
    .or(`and(proposed_month.eq.${month},performance_type.eq.music),proposal_key.eq.${key}`)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1)
}

export async function recommendPrivateCatalogMusic(db: Database, month: string, mode: Mode): Promise<PrivateProgrammingResult> {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid proposed month')
  const proposalKey = 'inventory-music-' + month
  let stage: Stage = 'existing_proposals'
  try {
    // A scheduled run must respect *every* existing monthly music proposal,
    // including rejected ones. Manual selected-month requests retain their
    // prior policy: only active proposals occupy the month, but the permanent
    // inventory key still prevents a rejected inventory idea being recreated.
    const existing = mode === 'automatic'
      ? await findExisting(db, month, proposalKey)
      : await db.from('cs_programming_proposals').select(proposalFields)
        .eq('proposed_month', month).eq('performance_type', 'music').neq('status', 'rejected').limit(1)
    if (existing.error) throw new PrivateProgrammingError(stage)
    if (existing.data?.length) return { status: 'existing', month, proposal: existing.data[0] }

    stage = 'catalog_inventory'
    const catalog = await db.from('cs_music_catalog')
      .select('id,release_title,artist_name,reported_track_count,catalog_status,streaming_status')
      .eq('artist_name', 'THE Verse Alkemist')
      .order('release_title', { ascending: true }).order('id', { ascending: true }).limit(60)
    if (catalog.error) throw new PrivateProgrammingError(stage)
    const eligible = (catalog.data || []).filter(row => typeof row.release_title === 'string'
      && row.release_title.trim().length > 0 && titlePrefix.length + row.release_title.length <= 240)
    if (!eligible.length) return { status: 'empty_catalog', month }

    // Stable inventory rotation only, not engagement analysis or endorsement.
    const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7))
    const chosen = eligible[index % eligible.length]
    const row = {
      proposal_key: proposalKey, proposed_month: month, performance_type: 'music',
      title: titlePrefix + chosen.release_title,
      description: 'Private programming idea based solely on the existing DistroKid-derived release inventory. Artist and track identifiers, assets, rights, release status, and performance readiness require verification. This is not a confirmed event.',
      production_brief: 'Evaluate a virtual Café Sativa performance or listening-room feature for ' + chosen.release_title + '. Before any budget or production: verify mastered audio, permitted voices and likenesses, stems, asset provenance, canonical stage, storyboard and explicit owner approval. Do not render or schedule without further approval.',
      artist_name: chosen.artist_name, source_catalog_id: chosen.id,
      source_evidence: [{ kind: 'internal_release_inventory', catalogId: chosen.id, releaseTitle: chosen.release_title, catalogStatus: chosen.catalog_status, streamingStatus: chosen.streaming_status, reportedTrackCount: chosen.reported_track_count, engagementEvidence: false, externallyVerified: false }],
      source_type: 'inventory', confidence: 'low', status: 'draft',
    }
    stage = 'save_proposal'
    const inserted = await db.from('cs_programming_proposals').insert(row).select(proposalFields).single()
    if (inserted.error?.code === '23505') {
      // Another planner or owner won. Verify it rather than swallowing an
      // unrelated uniqueness error or claiming a proposal was created.
      stage = 'concurrent_proposal'
      const winner = await findExisting(db, month, proposalKey)
      if (winner.error || !winner.data?.length) throw new PrivateProgrammingError(stage)
      return { status: 'existing', month, proposal: winner.data[0] }
    }
    if (inserted.error || !inserted.data) throw new PrivateProgrammingError(stage)
    return { status: 'created', month, proposal: inserted.data }
  } catch (error) {
    if (error instanceof PrivateProgrammingError) throw error
    // Include the failing stage, never provider messages, credentials or URLs.
    throw new PrivateProgrammingError(stage)
  }
}

export async function planPrivateProgramming(now: Date = new Date()) {
  return recommendPrivateCatalogMusic(createAdminClient(), localDate(now).slice(0, 7), 'automatic')
}
