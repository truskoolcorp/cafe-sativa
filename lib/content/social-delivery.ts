import { createAdminClient } from '@/lib/supabase/admin'
import { approvedMediaJob } from '@/lib/content/approved-media'
import { siteMediaApproved } from '@/lib/content/site'
import { captionHash,socialCreateArguments,socialPostMatches,validSocialApproval } from '@/lib/content/social-contract'
import { withSocialConnection } from '@/lib/content/social-connection'

export async function queueSocialFeature(item:any,userId:string) {
  if(!item.media_url || !item.source_job_id || !await siteMediaApproved(item) || Array.from(item.copy_final || '').length>500 || new Date(item.scheduled_at).getTime()<Date.now()+1800000)throw new Error('Approved clip, caption up to 500 characters and future release time required')
  const result=await createAdminClient().from('cs_social_deliveries').insert({content_item_id:item.id,source_job_id:item.source_job_id,state:'queued',caption:item.copy_final,caption_hash:captionHash(item.copy_final),scheduled_at:item.scheduled_at,approved_by:userId,approved_at:new Date().toISOString()})
  if(result.error)throw result.error
}

export async function processSocialDelivery(options:{readOnly?:boolean}={}) {
  return withSocialConnection(async({db,session,brand,enabled})=>{
    const stale=await db.from('cs_social_deliveries').update({state:'submission_unknown',error:'Submission interrupted. Inspect Metricool before any manual retry.',updated_at:new Date().toISOString()}).eq('state','submitting').lt('submitted_at',new Date(Date.now()-600000).toISOString())
    if(stale.error)throw stale.error
    // Reconcile durable receipts separately from new submissions. Missing from this
    // pending-only endpoint does not establish publication or failure.
    const receipts=await db.from('cs_social_deliveries').select('*').eq('state','scheduled').order('scheduled_at').limit(20)
    if(receipts.error)throw receipts.error
    if(receipts.data?.length) {
      const times=receipts.data.map(row=>new Date(row.scheduled_at).getTime())
      const found=await session.call('getScheduledPosts',{brandId:'5373515',fromDate:new Date(Math.min(...times)-86400000).toISOString(),toDate:new Date(Math.max(...times)+86400000).toISOString(),timezone:brand.timezone,extendedRange:false})
      const posts=Array.isArray(found)?found:found.data
      if(!Array.isArray(posts))throw new Error('Invalid social receipt response')
      for(const row of receipts.data) {
        const post=posts.find((post:any)=>String(post.uuid)===row.provider_uuid)
        const update=await db.from('cs_social_deliveries').update({checked_at:new Date().toISOString(),...(post?{provider_post_id:post.id,receipt:{uuid:post.uuid,providers:post.providers,publicationDate:post.publicationDate,autoPublish:post.autoPublish,observation:'Still present in the scheduled-post queue'}}:{receipt:{...(row.receipt || {}),observation:'Not present in pending queue; publication remains unconfirmed'}})}).eq('id',row.id).eq('state','scheduled')
        if(update.error)throw update.error
      }
    }
    if(!enabled || options.readOnly)return {status:'verified',dispatchEnabled:false,reconciled:receipts.data?.length || 0}
    const next=await db.from('cs_social_deliveries').select('*').eq('state','queued').order('scheduled_at').limit(1).maybeSingle()
    if(next.error)throw next.error
    if(!next.data)return {status:'idle',reconciled:receipts.data?.length || 0}
    const row=next.data
    const fail=async(message:string,state='blocked')=>{const result=await db.from('cs_social_deliveries').update({state,error:message,updated_at:new Date().toISOString()}).eq('id',row.id).in('state',['queued','submitting']);if(result.error)throw result.error;return {status:state,error:message}}
    const item=await db.from('content_items').select('*').eq('id',row.content_item_id).maybeSingle()
    if(item.error)throw item.error
    if(!validSocialApproval(row,item.data))return fail('Website approval, caption or release time changed. Review delivery again.')
    const job=await approvedMediaJob(item.data)
    if(!job)return fail('Current approved clip and canonical room reference required')
    const window={brandId:'5373515',fromDate:new Date(new Date(row.scheduled_at).getTime()-86400000).toISOString(),toDate:new Date(new Date(row.scheduled_at).getTime()+86400000).toISOString(),timezone:brand.timezone,extendedRange:false}
    const before=await session.call('getScheduledPosts',window)
    const posts=Array.isArray(before)?before:before.data
    if(!Array.isArray(posts))throw new Error('Invalid scheduled-post response')
    if(posts.some((post:any)=>socialPostMatches(post,row,brand.timezone)))return fail('A matching caption and time already exist in Metricool. Review instead of creating a duplicate.')
    const media=await db.storage.from('cafe-sativa-content').createSignedUrl(job.output_url,3600)
    if(media.error || !media.data)throw new Error('Approved media unavailable')
    const claim=await db.from('cs_social_deliveries').update({state:'submitting',submitted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',row.id).eq('state','queued').select('id').maybeSingle()
    if(claim.error)throw claim.error
    if(!claim.data)return {status:'already_claimed'}
    try {
      await session.call('createScheduledPost',socialCreateArguments(row,brand.timezone,media.data.signedUrl))
      const after=await session.call('getScheduledPosts',window)
      const saved=(Array.isArray(after)?after:after.data)?.filter((post:any)=>socialPostMatches(post,row,brand.timezone) && post.autoPublish===true && post.draft===false && post.media?.length>0 && post.media.every((url:unknown)=>typeof url==='string' && url.startsWith('https://static.metricool.com/')) && post.uuid && post.id)
      if(!Array.isArray(saved) || saved.length!==1)return fail('Submission result is ambiguous. Inspect Metricool; no automatic retry.','submission_unknown')
      const post=saved[0]
      const receipt=await db.from('cs_social_deliveries').update({state:'scheduled',provider_post_id:post.id,provider_uuid:String(post.uuid),receipt:{uuid:post.uuid,providers:post.providers,publicationDate:post.publicationDate,autoPublish:post.autoPublish,observation:'Scheduling confirmed, not publication'},error:null,checked_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',row.id).eq('state','submitting')
      if(receipt.error)throw receipt.error
      return {status:'scheduled',deliveryId:row.id,postId:post.id}
    }catch{return fail('Submission may have reached Metricool. Inspect before any manual retry.','submission_unknown')}
  })
}
