import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { isContentAdmin } from '@/lib/content/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { approvedAsset, CONTENT_POLICY } from '@/lib/content/policy'
import { MEDIA_UUID } from '@/lib/content/approved-media'
import { boundedVideoBody, normalizeReplacementVideo } from '@/lib/content/replacement-video'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
const response=(body:any,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function POST(req:NextRequest) {
  if(!await isContentAdmin())return response({error:'Unauthorized'},401)
  if(req.headers.get('origin')!==req.nextUrl.origin)return response({error:'Invalid origin'},403)
  try {
  const {data:{user}}=await createClient().auth.getUser()
  if(!user || user.app_metadata?.cafe_sativa_admin!==true)return response({error:'Unauthorized'},401)
  const id=req.headers.get('x-cs-job-id'),revision=req.headers.get('x-cs-job-revision')
  const canonicalId=req.headers.get('x-cs-canonical-id'),canonicalHash=req.headers.get('x-cs-canonical-sha256'),canonicalVersion=req.headers.get('x-cs-canonical-version')
  if(!id || !MEDIA_UUID.test(id) || !revision || revision.length>64 || !canonicalId || !MEDIA_UUID.test(canonicalId) || !/^[a-f0-9]{64}$/.test(canonicalHash||'') || !canonicalVersion || canonicalVersion.length>200)return response({error:'Current job and reference snapshot required'},400)
  const db=createAdminClient()
    const found=await db.from('cs_content_jobs').select('*').eq('id',id).maybeSingle()
    if(found.error)throw found.error
    const job=found.data
    if(!job || job.status!=='pending_qa' || job.updated_at!==revision || job.policy_version!==CONTENT_POLICY.version || job.canonical_asset_id!==canonicalId || typeof job.output_url!=='string' || !MEDIA_UUID.test(job.output_url.slice(0,-4)) || !job.output_url.endsWith('.mp4'))return response({error:'Job changed or is not awaiting review. Refresh.'},409)
    const getMaster=async()=>{
      const result=await db.from('cs_canonical_assets').select('*').eq('kind','venue').eq('subject',job.room).eq('active',true)
      if(result.error)throw result.error
      const valid=(result.data||[]).filter(approvedAsset)
      return valid.length===1 && valid[0].id===canonicalId && valid[0].sha256===canonicalHash && valid[0].version===canonicalVersion
    }
    if(!await getMaster())return response({error:'Approved reference changed. Refresh.'},409)
    let media
    try {media=await normalizeReplacementVideo(await boundedVideoBody(req))}catch{return response({error:'Use a valid MP4 no larger than 3 MiB. Preview will be silent and limited to five seconds.'},400)}
    if(!await getMaster())return response({error:'Approved reference changed during upload. Refresh.'},409)
    const path=randomUUID()+'.mp4',bucket=db.storage.from('cafe-sativa-content')
    const provenance={version:1,jobId:id,previousOutput:job.output_url,actorId:user.id,uploadedAt:new Date().toISOString(),sourceSha256:media.sourceSha256,storedSha256:media.storedSha256,canonicalSnapshot:{id:canonicalId,sha256:canonicalHash,version:canonicalVersion},transform:'silent-fit-1280x720-max5s-24fps',qaApproved:false,published:false}
    const saved=await bucket.upload(path,media.bytes,{contentType:'video/mp4',upsert:false,metadata:{replacementProvenance:provenance}})
    if(saved.error)throw saved.error
    // CAS prevents a concurrent review/replacement from inheriting an unseen video.
    const changed=await db.from('cs_content_jobs').update({output_url:path,qa_approved_by:null,qa_approved_at:null,updated_at:new Date().toISOString(),blocker:`Private replacement uploaded by ${user.id}; source SHA256 ${media.sourceSha256}; stored SHA256 ${media.storedSha256}; canonical ${canonicalId}/${canonicalHash}; visual accuracy and caption review still required.`}).eq('id',id).eq('status','pending_qa').eq('updated_at',revision).eq('output_url',job.output_url).select('id,status').maybeSingle()
    // Never delete here: an uncertain database response must not remove a possibly linked object.
    if(changed.error)throw changed.error
    if(!changed.data)return response({error:'Another review changed this job. Replacement was not attached; refresh.'},409)
    return response({...changed.data,message:'Private replacement saved. Watch the new preview and complete accuracy review. Nothing was approved or published.'})
  }catch{return response({error:'Replacement could not be confirmed. Refresh before retrying.'},503)}
}
