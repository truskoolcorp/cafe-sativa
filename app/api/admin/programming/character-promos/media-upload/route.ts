import {createHash} from 'node:crypto'
import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export const runtime='nodejs'
const HEADERS={'Cache-Control':'private, no-store'}
// Keep below Vercel's serverless request body limit; larger media requires direct-to-storage upload.
const MAX_BYTES=4*1024*1024
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:HEADERS})
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return json({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return json({error:'Invalid origin'},403)
 const length=Number(req.headers.get('content-length')||0)
 if(!Number.isFinite(length)||length>MAX_BYTES+4096)return json({error:'Upload exceeds size limit'},413)
 let form:FormData
 try{form=await req.formData()}catch{return json({error:'Invalid multipart upload'},400)}
 const id=form.get('promoId'),asset=form.get('video')
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||!(asset instanceof File))return json({error:'Select a promo and MP4 file'},400)
 if(asset.size===0||asset.size>MAX_BYTES||asset.type!=='video/mp4')return json({error:'Only MP4 video up to 4 MB is supported'},400)
 const bytes=Buffer.from(await asset.arrayBuffer())
 if(bytes.length<16||bytes.toString('ascii',4,8)!=='ftyp')return json({error:'Invalid MP4 signature'},400)
 const sha=createHash('sha256').update(bytes).digest('hex')
 const db=createAdminClient()
 const found=await db.from('cs_character_promo_drafts').select('id,character_id,status,video_asset_path').eq('id',id).maybeSingle()
 if(found.error||!found.data)return json({error:'Promo draft not found'},404)
 if(!['draft','revision_requested'].includes(found.data.status)||found.data.video_asset_path)return json({error:'Draft is not eligible for a new unapproved upload'},409)
 const path='character-promos/'+found.data.character_id+'/'+id+'/'+sha+'.mp4'
 const uploaded=await db.storage.from('cafe-sativa-content').upload(path,bytes,{contentType:'video/mp4',upsert:false})
 if(uploaded.error&& !/already exists|duplicate/i.test(uploaded.error.message))return json({error:'Private media storage unavailable'},503)
 const saved=await db.from('cs_character_promo_drafts').update({video_asset_path:path,video_qa_approved_at:null,publication_approved_at:null,updated_at:new Date().toISOString()}).eq('id',id).is('video_asset_path',null).in('status',['draft','revision_requested']).select('id,video_asset_path').maybeSingle()
 if(saved.error||!saved.data)return json({error:'Asset retained in private storage but draft changed concurrently; review before continuing'},409)
 await db.from('cs_character_promo_qa_checks').upsert({promo_id:id,video_sha256:sha,check_name:'mp4_integrity',result:'pass',evidence:'Server-side MP4 header and byte-length validated; SHA-256 fingerprint calculated.'},{onConflict:'promo_id,video_sha256,check_name'})
 return json({promoId:id,sha256:sha,privatePath:path,size:bytes.length,qaApproved:false,publishingAllowed:false,providerCallsStarted:false},201)
}
