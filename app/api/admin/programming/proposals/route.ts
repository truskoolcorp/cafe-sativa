import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers})
export async function GET(){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 const db=createAdminClient()
 const r=await db.from('cs_programming_proposals').select('id,proposal_key,proposed_month,performance_type,title,description,production_brief,artist_name,source_catalog_id,source_evidence,confidence,status,source_type,proposed_start,created_at').order('created_at',{ascending:false}).limit(150)
 if(r.error)return reply({error:'Private proposal queue unavailable'},503)
 return reply({proposals:r.data||[],publicEventsCreated:false,renderingEnabled:false})
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 if(Number(req.headers.get('content-length'))>12000)return reply({error:'Request too large'},413)
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.title!=='string'||!b.title.trim()||b.title.length>240||typeof b.month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(b.month)||!['music','comedy','spoken_word','interview','other'].includes(b.type)||typeof b.description!=='string'||b.description.length>2500||typeof b.brief!=='string'||b.brief.length>5000)return reply({error:'Invalid proposal fields'},400)
 const db=createAdminClient()
 let source:null|{id:string;release_title:string;artist_name:string}=null
 if(b.catalogId){
  if(typeof b.catalogId!=='string'||!/^[0-9a-f-]{36}$/i.test(b.catalogId))return reply({error:'Invalid source catalog reference'},400)
  const q=await db.from('cs_music_catalog').select('id,release_title,artist_name').eq('id',b.catalogId).maybeSingle()
  if(q.error||!q.data)return reply({error:'Catalog source not found'},400)
  source=q.data
 }
 const created=await db.from('cs_programming_proposals').insert({
  proposal_key:'owner-'+crypto.randomUUID(),proposed_month:b.month,performance_type:b.type,
  title:b.title.trim(),description:b.description,production_brief:b.brief,
  artist_name:source?.artist_name||null,source_catalog_id:source?.id||null,
  source_evidence:source?[{source:'owner_distrokid_inventory',releaseTitle:source.release_title,verified:false}]:[],
  confidence:'low',source_type:'owner',status:'draft'
 }).select('id,status').single()
 if(created.error)return reply({error:created.error.code==='23505'?'A music proposal already occupies this month':'Could not save private proposal'},created.error.code==='23505'?409:503)
 return reply({proposal:created.data,publicEventCreated:false,renderingStarted:false,publishingStarted:false},201)
}

export async function PATCH(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 if(Number(req.headers.get('content-length'))>12000)return reply({error:'Request too large'},413)
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.id!=='string'||!/^[0-9a-f-]{36}$/i.test(b.id)||typeof b.title!=='string'||!b.title.trim()||b.title.length>240||typeof b.description!=='string'||b.description.length>2500||typeof b.brief!=='string'||b.brief.length>5000||typeof b.month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(b.month)||!['music','comedy','spoken_word','interview','other'].includes(b.type))return reply({error:'Invalid revision fields'},400)
 const db=createAdminClient()
 const existing=await db.from('cs_programming_proposals').select('id,status').eq('id',b.id).maybeSingle()
 if(existing.error||!existing.data)return reply({error:'Proposal unavailable'},404)
 if(!['draft','owner_review','revision_requested'].includes(existing.data.status))return reply({error:'This proposal is not editable'},409)
 // Keep revisions private; do not infer concept, spending or publication approval.
 const updated=await db.from('cs_programming_proposals').update({title:b.title.trim(),description:b.description,production_brief:b.brief,proposed_month:b.month,performance_type:b.type,status:'revision_requested',updated_at:new Date().toISOString()}).eq('id',b.id).eq('status',existing.data.status).select('id,status').maybeSingle()
 if(updated.error)return reply({error:updated.error.code==='23505'?'A musical proposal already occupies that month':'Revision unavailable'},updated.error.code==='23505'?409:503)
 if(!updated.data)return reply({error:'Proposal changed concurrently; reload before editing'},409)
 return reply({proposal:updated.data,publicEventCreated:false,renderingStarted:false,publishingStarted:false})
}
