import {createHash} from 'node:crypto'
import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export const runtime='nodejs'
const reply=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'private, no-store'}})
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.promoId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.promoId)||typeof b.path!=='string')return reply({error:'Invalid upload reference'},400)
 const db=createAdminClient()
 const r=await db.from('cs_character_promo_drafts').select('id,character_id,status,video_asset_path').eq('id',b.promoId).maybeSingle()
 if(r.error||!r.data)return reply({error:'Promo unavailable'},404)
 if(!['draft','revision_requested'].includes(r.data.status)||r.data.video_asset_path)return reply({error:'Draft is no longer accepting media'},409)
 const expected=new RegExp('^character-promos/'+r.data.character_id+'/'+r.data.id+'/incoming-[a-f0-9-]{36}\\.mp4$')
 if(!expected.test(b.path))return reply({error:'Upload does not belong to this promo'},403)
 const obj=await db.storage.from('cafe-sativa-content').download(b.path)
 if(obj.error||!obj.data)return reply({error:'Uploaded MP4 not found'},404)
 const bytes=Buffer.from(await obj.data.arrayBuffer())
 if(bytes.length<16||bytes.length>35*1024*1024||bytes.toString('ascii',4,8)!=='ftyp')return reply({error:'Uploaded media failed MP4 or size verification'},422)
 const sha=createHash('sha256').update(bytes).digest('hex')
 const destination='character-promos/'+r.data.character_id+'/'+r.data.id+'/'+sha+'.mp4'
 const moved=await db.storage.from('cafe-sativa-content').move(b.path,destination)
 if(moved.error&&!/already exists|duplicate/i.test(moved.error.message))return reply({error:'Unable to finalize private media'},503)
 const saved=await db.from('cs_character_promo_drafts').update({video_asset_path:destination,video_qa_approved_at:null,publication_approved_at:null,updated_at:new Date().toISOString()}).eq('id',r.data.id).is('video_asset_path',null).in('status',['draft','revision_requested']).select('id').maybeSingle()
 if(saved.error||!saved.data)return reply({error:'Media stored privately but draft changed; manual reconciliation required'},409)
 await db.from('cs_character_promo_qa_checks').upsert({promo_id:r.data.id,video_sha256:sha,check_name:'mp4_integrity',result:'pass',evidence:'Uploaded bytes downloaded, MP4 signature and length validated, SHA-256 fingerprint calculated.'},{onConflict:'promo_id,video_sha256,check_name'})
 return reply({promoId:r.data.id,sha256:sha,privatePath:destination,bytes:bytes.length,qaApproved:false,renderedBySystem:false,published:false},201)
}
