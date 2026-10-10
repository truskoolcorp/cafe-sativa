import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { approvedMediaJob, itemMediaUrl } from '@/lib/content/approved-media'
import { SITE_CATEGORIES } from '@/lib/content/site'

export async function planApprovedClipFeatures(now=new Date()) {
  const db=createAdminClient()
  const jobs=await db.from('cs_content_jobs').select('*').in('status',['approved','scheduled','published']).order('created_at',{ascending:false}).limit(100)
  if(jobs.error)throw jobs.error
  let planned=0
  for(const job of jobs.data || []) {
    if(!SITE_CATEGORIES.some(category=>category===job.room) || !job.title?.trim() || !job.caption?.trim())continue
    // The original pilot already has a feature. Never duplicate it or replace owner edits.
    const existing=await db.from('content_items').select('id').eq('source_job_id',job.id).limit(1)
    if(existing.error)throw existing.error
    if(existing.data?.length)continue
    const id=randomUUID()
    const draft={id,site_category:job.room,source_job_id:job.id,media_url:itemMediaUrl(id)}
    if(!await approvedMediaJob(draft))continue
    const result=await db.from('content_items').insert({...draft,site_key:`approved-clip:${job.id}`,title:job.title,copy_draft:job.caption,copy_final:null,channel:'lounge_announcement',agent:'commander',status:'pending_approval',scheduled_at:now.toISOString(),approved_by:null,approved_at:null,approval_notes:'Clip accuracy review passed. Review this website caption and choose its release time; website approval is required before the overview or video becomes public.'})
    if(result.error && result.error.code!=='23505')throw result.error
    if(!result.error)planned++
  }
  return planned
}
