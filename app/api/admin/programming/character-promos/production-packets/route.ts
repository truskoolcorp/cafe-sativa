import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
import {GLYPH_CHARACTER_SNAPSHOT} from '@/lib/content/glyph-characters'
import {liveGlyphCharacters} from '@/lib/content/glyph-live'
export const dynamic='force-dynamic'
export async function GET(){
 const headers={'Cache-Control':'private, no-store'}
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const db=createAdminClient()
 const r=await db.from('cs_character_promo_drafts').select('id,character_id,title,spoken_script,visual_brief,duration_seconds,status,intended_channel,actual_social_account,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at').order('created_at',{ascending:false}).limit(100)
 if(r.error)return NextResponse.json({error:'Draft inventory unavailable'},{status:503,headers})
 let registry:{live:boolean;characters:{id:string;voice_status?:string;rights_status?:string;primary_asset_id?:string|null;production_ready?:boolean}[]}|null=null
 try{registry=await liveGlyphCharacters()}catch{}
 const packets=(r.data||[]).map(d=>{
  const baseline=GLYPH_CHARACTER_SNAPSHOT.characters.find(c=>c.id===d.character_id)
  const current=registry?.characters.find(c=>c.id===d.character_id)
  const blockers:string[]=[]
  if(!registry?.live||!current)blockers.push('Live GLYPH canon verification unavailable')
  if(current?.rights_status!=='approved')blockers.push('Live character rights not approved')
  if(!current?.primary_asset_id)blockers.push('Canonical portrait unavailable')
  if(!baseline?.voice_id||current?.voice_status!=='canonical')blockers.push('Canonical speech voice unresolved')
  if(!d.audio_asset_path||!d.voice_approved_at)blockers.push('Spoken audio not produced and verified')
  if(!d.video_asset_path||!d.video_qa_approved_at)blockers.push('Finished video and QA missing')
  if(!d.actual_social_account)blockers.push('Exact social account mapping missing')
  if(!d.publication_approved_at)blockers.push('Publication readiness missing')
  return {id:d.id,title:d.title,characterId:d.character_id,script:d.spoken_script,visualBrief:d.visual_brief,targetDurationSeconds:d.duration_seconds,intendedChannel:d.intended_channel,canonicalReference:baseline?{assetId:baseline.primary_asset_id,sha256:baseline.sha256,voiceId:baseline.voice_id,baselineOnly:true}:null,liveCanonVerified:!!current&&registry?.live===true,readyForGeneration:false,readyForPublishing:false,blockers}
 })
 return NextResponse.json({packets,notice:'Preparation only. Snapshot IDs are references, never substitute for live GLYPH verification. No rendering, payments, scheduling or publishing occurred.',liveCanonSourceAvailable:registry?.live===true},{headers})
}
