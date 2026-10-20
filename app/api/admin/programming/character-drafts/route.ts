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
 let body:{characterId?:unknown;title?:unknown;brief?:unknown}
 try{body=await req.json()}catch{return reply({error:'Invalid request'},400)}
 const {characterId,title,brief}=body
 if(typeof characterId!=='string'||!/^[a-z0-9-]{2,100}$/.test(characterId)||typeof title!=='string'||!title.trim()||title.trim().length>240||typeof brief!=='string'||brief.length>5000)return reply({error:'Provide a valid character, title and brief'},400)
 let registry
 try{registry=await liveGlyphCharacters()}catch{return reply({error:'Live GLYPH validation unavailable. No draft saved.'},503)}
 if(!registry.live)return reply({error:'Live canonical character registry required'},503)
 const character=registry.characters.find((c:{id:string})=>c.id===characterId)
 if(!character)return reply({error:'Character not in approved GLYPH registry'},400)
 try{
  const db=createAdminClient()
  const saved=await db.from('cs_character_video_jobs').insert({character_id:characterId,title:title.trim(),brief:brief.trim(),status:'draft'}).select('id,status,character_id,title,created_at').single()
  if(saved.error)throw saved.error
  return reply({saved:true,job:saved.data,renderingStarted:false,publishingStarted:false},201)
 }catch{return reply({error:'Draft could not be saved'},503)}
}
