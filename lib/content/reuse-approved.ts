import { createAdminClient } from '@/lib/supabase/admin'
import { approvedAsset, CanonicalAsset, CONTENT_POLICY } from '@/lib/content/policy'

const privateClip = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i
const approvedSource = (job: any) => ['approved','scheduled','published'].includes(job.status) && job.qa_approved_by && job.qa_approved_at && privateClip.test(job.output_url || '') && (job.policy_version===CONTENT_POLICY.version || (job.policy_version==='2026-10-07' && typeof job.blocker==='string' && job.blocker.startsWith('Owner visual override by ')))

// Prepare only a private review draft. Final QA and publication gates remain
// mandatory; these reads are deliberately not a publication authorization.
export async function reuseApprovedWhilePaused() {
  const db = createAdminClient()
  const references = await db.from('cs_canonical_assets').select('*').eq('kind','venue').eq('active',true).order('subject').order('id')
  if (references.error) throw references.error
  const valid = (references.data || []).filter(asset=>approvedAsset(asset as CanonicalAsset))
  const assets = valid.filter(asset=>valid.filter(other=>other.subject===asset.subject).length===1)
  for (const asset of assets) {
    const pending = await db.from('cs_content_jobs').select('id').eq('canonical_asset_id',asset.id).eq('status','pending_qa').limit(1)
    if (pending.error) throw pending.error
    if (pending.data?.length) continue
    const drafts = await db.from('cs_content_jobs').select('*').eq('room',asset.subject).eq('status','planned').eq('policy_version',CONTENT_POLICY.version).order('created_at').order('id').limit(100)
    if (drafts.error) throw drafts.error
    const draft = drafts.data?.find(job=>job.caption?.trim() && job.title?.trim() && (!job.canonical_asset_id || job.canonical_asset_id===asset.id))
    if (!draft) continue
    const sources = await db.from('cs_content_jobs').select('*').eq('room',asset.subject).eq('canonical_asset_id',asset.id).in('status',['approved','scheduled','published']).order('created_at',{ascending:false}).limit(100)
    if (sources.error) throw sources.error
    const source = sources.data?.find(approvedSource)
    if (!source) continue
    // Recheck revocation, replacement and source QA immediately before the CAS.
    const current = await db.from('cs_canonical_assets').select('*').eq('kind','venue').eq('subject',asset.subject).eq('active',true)
    if (current.error) throw current.error
    const currentValid = (current.data || []).filter(row=>approvedAsset(row as CanonicalAsset))
    if (currentValid.length!==1 || currentValid[0].id!==asset.id || currentValid[0].version!==asset.version || currentValid[0].sha256!==asset.sha256) continue
    const fresh = await db.from('cs_content_jobs').select('*').eq('id',source.id).eq('room',asset.subject).eq('canonical_asset_id',asset.id).limit(1)
    if (fresh.error) throw fresh.error
    if (!fresh.data?.[0] || !approvedSource(fresh.data[0]) || fresh.data[0].output_url!==source.output_url || fresh.data[0].qa_approved_by!==source.qa_approved_by || fresh.data[0].qa_approved_at!==source.qa_approved_at) continue
    const stillPending = await db.from('cs_content_jobs').select('id').eq('canonical_asset_id',asset.id).eq('status','pending_qa').limit(1)
    if (stillPending.error) throw stillPending.error
    if (stillPending.data?.length) continue
    const result = await db.from('cs_content_jobs').update({canonical_asset_id:asset.id,output_url:source.output_url,status:'pending_qa',qa_approved_by:null,qa_approved_at:null,blocker:'Approved media reused without paid generation; review current caption and delivery time.',updated_at:new Date().toISOString()}).eq('id',draft.id).eq('status','planned').eq('updated_at',draft.updated_at).select('id')
    if (result.error) throw result.error
    // A competing worker may have prepared this draft. Do not fan out to another.
    return result.data?.length ? {reused:1,job_id:draft.id} : {reused:0}
  }
  return {reused:0}
}
