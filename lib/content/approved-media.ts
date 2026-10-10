import { createAdminClient } from '@/lib/supabase/admin'
import { approvedAsset, CONTENT_POLICY } from '@/lib/content/policy'

export const MEDIA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const itemMediaUrl = (id:string) => `/api/content/media/items/${id}`

// Website editorial approval and clip QA are separate requirements.
export async function approvedMediaJob(item:{id?:string;site_category?:string|null;source_job_id?:string|null;media_url?:string|null}) {
  if (!item.id || !MEDIA_UUID.test(item.id) || !item.source_job_id || !MEDIA_UUID.test(item.source_job_id) || item.media_url !== itemMediaUrl(item.id)) return null
  const db=createAdminClient()
  const found=await db.from('cs_content_jobs').select('*').eq('id',item.source_job_id).in('status',['approved','scheduled','published']).maybeSingle()
  if(found.error) throw found.error
  const job=found.data
  if(!job || !job.qa_approved_by || !job.qa_approved_at || job.policy_version!==CONTENT_POLICY.version || job.room!==item.site_category || typeof job.output_url!=='string' || !MEDIA_UUID.test(job.output_url.replace(/\.mp4$/,'')) || !job.output_url.endsWith('.mp4')) return null
  const canonical=await db.from('cs_canonical_assets').select('*').eq('id',job.canonical_asset_id).eq('kind','venue').eq('subject',job.room).maybeSingle()
  if(canonical.error) throw canonical.error
  return approvedAsset(canonical.data)?job:null
}
