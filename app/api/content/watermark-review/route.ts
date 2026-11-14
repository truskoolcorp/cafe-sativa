import { NextRequest,NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { inspectVenueBytes } from '@/lib/content/venue-watermark'
export const dynamic='force-dynamic'
export const maxDuration=30
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function POST(req:NextRequest){
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 try{
  const {data:{user},error}=await createClient().auth.getUser()
  if(error||!user||user.app_metadata?.cafe_sativa_admin!==true)return reply({error:'Unauthorized'},401)
  const reader=req.body?.getReader();if(!reader)return reply({error:'Review required'},400)
  const chunks:Uint8Array[]=[];let count=0
  try{while(true){const chunk=await reader.read();if(chunk.done)break;count+=chunk.value.length;if(count>4096){await reader.cancel();return reply({error:'Too large'},413)}chunks.push(chunk.value)}}finally{reader.releaseLock()}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if(!/^[0-9a-f-]{36}$/i.test(body.jobId||'')||!['pass','fail','needs_review'].includes(body.result)||typeof body.evidence!=='string'||!body.evidence.trim()||body.evidence.length>1000||!/^[a-f0-9]{64}$/.test(body.sha256||'')||body.fullClipReviewed!==true)return reply({error:'Exact hash, full-clip review and evidence required'},400)
  const db=createAdminClient(),found=await db.from('cs_content_jobs').select('id,output_url,updated_at').eq('id',body.jobId).maybeSingle()
  if(found.error||!found.data)return reply({error:'Job unavailable'},409)
  const path=body.objectPath||found.data.output_url
  const actual=await inspectVenueBytes(db,{id:found.data.id,output_url:path})
  if(actual.sha256!==body.sha256)return reply({error:'Media changed; review exact current bytes'},409)
  const saved=await db.rpc('cs_record_venue_watermark_review',{p_job_id:found.data.id,p_job_revision:found.data.updated_at,p_object_path:path,p_sha256:actual.sha256,p_result:body.result,p_evidence:body.evidence.trim(),p_actor:user.id,p_expected_review_at:body.expectedReviewAt||null})
  if(saved.error||!saved.data)return reply({error:'Review not saved; refresh before retry'},409)
  return reply({saved:true,sha256:actual.sha256,publicationApproved:false})
 }catch{return reply({error:'Review unavailable; no publication authorized'},503)}
}
