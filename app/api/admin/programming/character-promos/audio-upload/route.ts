import {createHash} from 'node:crypto'
import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export const runtime='nodejs'
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 const length=Number(req.headers.get('content-length')||0)
 if(length>3*1024*1024)return reply({error:'Audio request too large'},413)
 const form=await req.formData().catch(()=>null)
 const id=form?.get('promoId'), file=form?.get('audio')
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||!(file instanceof File))return reply({error:'Missing promo and audio file'},400)
 if(file.size<32||file.size>2*1024*1024||!['audio/mpeg','audio/mp3'].includes(file.type))return reply({error:'MP3 only, maximum 2 MB'},400)
 const bytes=Buffer.from(await file.arrayBuffer())
 const header=bytes.subarray(0,3).toString('ascii')
 const frame=(bytes[0]===255 && (bytes[1]&224)===224)
 if(header!=='ID3'&&!frame)return reply({error:'MP3 signature invalid'},422)
 const db=createAdminClient()
 const draft=await db.from('cs_character_promo_drafts').select('id,character_id,status,audio_asset_path').eq('id',id).maybeSingle()
 if(draft.error||!draft.data)return reply({error:'Promo not found'},404)
 if(!['draft','revision_requested'].includes(draft.data.status)||draft.data.audio_asset_path)return reply({error:'Audio already assigned or draft locked'},409)
 const sha=createHash('sha256').update(bytes).digest('hex')
 const path='character-promos/'+draft.data.character_id+'/'+id+'/'+sha+'.mp3'
 const uploaded=await db.storage.from('cafe-sativa-audio').upload(path,bytes,{contentType:'audio/mpeg',upsert:false})
 if(uploaded.error&&!/already exists|duplicate/i.test(uploaded.error.message))return reply({error:'Private audio storage unavailable'},503)
 const result=await db.from('cs_character_promo_drafts').update({audio_asset_path:path,voice_approved_at:null,publication_approved_at:null,updated_at:new Date().toISOString()}).eq('id',id).is('audio_asset_path',null).in('status',['draft','revision_requested']).select('id').maybeSingle()
 if(result.error||!result.data)return reply({error:'Audio stored but draft changed; reconciliation required'},409)
 return reply({promoId:id,sha256:sha,privatePath:path,sizeBytes:bytes.length,voiceApproved:false,published:false},201)
}
