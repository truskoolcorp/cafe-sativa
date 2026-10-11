import { createAdminClient } from '@/lib/supabase/admin'
import { approvedAsset,CONTENT_POLICY } from '@/lib/content/policy'
import { INITIAL_VENUE_PREVIEWS } from '@/lib/content/venue-programs'
export async function planReferencePreviews() {
 const db=createAdminClient(),assets=await db.from('cs_canonical_assets').select('*').eq('kind','venue').eq('active',true)
 if(assets.error)throw assets.error
 let planned=0
 for(const brief of INITIAL_VENUE_PREVIEWS) {
  const matches=(assets.data || []).filter(row=>row.subject===brief.room && approvedAsset(row))
  if(matches.length!==1)continue
  const asset=matches[0]
  const exists=await db.from('cs_content_jobs').select('id').eq('canonical_asset_id',asset.id).limit(1)
  if(exists.error)throw exists.error
  if(exists.data?.length)continue
  const inserted=await db.from('cs_content_jobs').upsert({slot_key:`reference-preview:${brief.room}:${asset.sha256}`,room:brief.room,canonical_asset_id:asset.id,title:brief.title,caption:brief.caption,camera_action:'A subtle, steady camera push preserving this exact empty room and its geometry.',policy_version:CONTENT_POLICY.version,status:'planned'},{onConflict:'slot_key',ignoreDuplicates:true}).select('id')
  if(inserted.error)throw inserted.error
  planned+=inserted.data?.length || 0
 }
 return planned
}
