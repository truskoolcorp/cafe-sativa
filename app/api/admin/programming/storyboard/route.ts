import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers})
export async function GET(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 const jobId=req.nextUrl.searchParams.get('jobId')
 if(!jobId||!/^[0-9a-f-]{36}$/i.test(jobId))return reply({error:'Invalid job ID'},400)
 const db=createAdminClient()
 const [job,shots]=await Promise.all([
  db.from('cs_character_video_jobs').select('id,title,character_id,production_kind,performance_month,status,budget_cap_usd,budget_approved_at').eq('id',jobId).maybeSingle(),
  db.from('cs_performance_storyboard_shots').select('id,shot_number,start_ms,end_ms,scene_brief,camera_note,performer_note,instrument_note,reference_path,reference_sha256,review_status').eq('job_id',jobId).order('shot_number')
 ])
 if(job.error||shots.error)return reply({error:'Storyboard unavailable'},503)
 if(!job.data)return reply({error:'Production not found'},404)
 return reply({job:job.data,shots:shots.data||[],renderingEnabled:false})
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.jobId!=='string'||!/^[0-9a-f-]{36}$/i.test(b.jobId)||!Number.isInteger(b.shotNumber)||b.shotNumber<1||b.shotNumber>300||!Number.isInteger(b.startMs)||!Number.isInteger(b.endMs)||b.startMs<0||b.endMs<=b.startMs||b.endMs-b.startMs>15000||typeof b.sceneBrief!=='string'||!b.sceneBrief.trim()||b.sceneBrief.length>2500||typeof b.cameraNote!=='string'||b.cameraNote.length>1000||typeof b.performerNote!=='string'||b.performerNote.length>1000||typeof b.instrumentNote!=='string'||b.instrumentNote.length>1000)return reply({error:'Invalid shot specification (1–15 seconds)'},400)
 const db=createAdminClient()
 const job=await db.from('cs_character_video_jobs').select('id,status').eq('id',b.jobId).maybeSingle()
 if(job.error||!job.data||job.data.status!=='draft')return reply({error:'Only draft productions permit adding shots'},409)
 const created=await db.from('cs_performance_storyboard_shots').insert({job_id:b.jobId,shot_number:b.shotNumber,start_ms:b.startMs,end_ms:b.endMs,scene_brief:b.sceneBrief.trim(),camera_note:b.cameraNote,performer_note:b.performerNote,instrument_note:b.instrumentNote,review_status:'pending'}).select('id').single()
 if(created.error)return reply({error:created.error.code==='23505'?'Shot number already exists':'Unable to save shot'},created.error.code==='23505'?409:503)
 return reply({saved:true,shotId:created.data.id,referenceGenerated:false,renderingStarted:false},201)
}
