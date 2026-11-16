import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {liveGlyphCharacters} from '@/lib/content/glyph-live'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers})
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 if(Number(req.headers.get('content-length'))>7000)return reply({error:'Brief too large'},413)
 let body:{characterId?:unknown;title?:unknown;brief?:unknown;audioSourceUrl?:unknown;productionKind?:unknown;performanceMonth?:unknown}
 try{body=await req.json()}catch{return reply({error:'Invalid request'},400)}
 const {characterId,title,brief,audioSourceUrl,productionKind='character_video',performanceMonth}=body
 if(productionKind!=='character_video'&&productionKind!=='full_music_performance')return reply({error:'Invalid production kind'},400)
 if(productionKind==='full_music_performance'&&(typeof performanceMonth!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(performanceMonth)))return reply({error:'Choose a valid calendar month for the one permitted full performance'},400)
 if(audioSourceUrl!==undefined&&(typeof audioSourceUrl!=='string'||(audioSourceUrl!==''&&!/^https:\/\/suno\.com\/s\/[a-zA-Z0-9]{8,32}\/?$/.test(audioSourceUrl))))return reply({error:'Only a valid Suno share URL is supported as a soundtrack reference'},400)
 if(typeof characterId!=='string'||!/^[a-z0-9-]{2,100}$/.test(characterId)||typeof title!=='string'||!title.trim()||title.trim().length>240||typeof brief!=='string'||brief.length>5000)return reply({error:'Provide a valid character, title and brief'},400)
 let registry
 try{registry=await liveGlyphCharacters()}catch{return reply({error:'Live GLYPH validation unavailable. No draft saved.'},503)}
 if(!registry.live)return reply({error:'Live canonical character registry required'},503)
 const character=registry.characters.find((c:{id:string})=>c.id===characterId)
 if(!character)return reply({error:'Character not in approved GLYPH registry'},400)
 try{
  const db=createAdminClient()
  const saved=await db.from('cs_character_video_jobs').insert({character_id:characterId,title:title.trim(),brief:brief.trim(),audio_source_url:audioSourceUrl||null,audio_source_provider:audioSourceUrl?'suno':null,audio_rights_status:'unverified',production_kind:productionKind,performance_month:productionKind==='full_music_performance'?performanceMonth:null,status:'draft'}).select('id,status,character_id,title,created_at').single()
  if(saved.error){if(saved.error.code==='23505')return reply({error:'A full musical performance already occupies this month. Review that draft instead of creating another.'},409);throw saved.error}
  return reply({saved:true,job:saved.data,renderingStarted:false,publishingStarted:false},201)
 }catch{return reply({error:'Draft could not be saved'},503)}
}
