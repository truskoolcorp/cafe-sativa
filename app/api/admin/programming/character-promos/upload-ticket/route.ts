import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const reply=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'private, no-store'}})
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.promoId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.promoId)||!Number.isSafeInteger(b.size)||b.size<16||b.size>35*1024*1024)return reply({error:'Provide a valid promo and an MP4 up to 35 MB'},400)
 const db=createAdminClient()
 const r=await db.from('cs_character_promo_drafts').select('id,character_id,status,video_asset_path').eq('id',b.promoId).maybeSingle()
 if(r.error||!r.data)return reply({error:'Promo not found'},404)
 if(!['draft','revision_requested'].includes(r.data.status)||r.data.video_asset_path)return reply({error:'Promo already has a video or is not editable'},409)
 const path='character-promos/'+r.data.character_id+'/'+r.data.id+'/incoming-'+crypto.randomUUID()+'.mp4'
 const created=await db.storage.from('cafe-sativa-content').createSignedUploadUrl(path)
 if(created.error||!created.data)return reply({error:'Unable to initialize private direct upload'},503)
 return reply({path:created.data.path,token:created.data.token,maxBytes:35*1024*1024,temporary:true,noPublishing:true})
}
