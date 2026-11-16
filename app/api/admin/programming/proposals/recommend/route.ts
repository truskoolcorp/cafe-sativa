import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return json({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return json({error:'Invalid origin'},403)
 if(Number(req.headers.get('content-length'))>1500)return json({error:'Request too large'},413)
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(b.month))return json({error:'Provide a valid proposed month'},400)
 const db=createAdminClient()
 const existing=await db.from('cs_programming_proposals').select('id,title,status').eq('proposed_month',b.month).eq('performance_type','music').neq('status','rejected').limit(1)
 if(existing.error)return json({error:'Unable to check monthly planning quota'},503)
 if(existing.data?.length)return json({error:'That month already has a musical proposal',proposal:existing.data[0]},409)
 const catalog=await db.from('cs_music_catalog').select('id,release_title,artist_name,reported_track_count,catalog_status,streaming_status').eq('artist_name','THE Verse Alkemist').order('release_title',{ascending:true}).limit(60)
 if(catalog.error)return json({error:'Catalog inventory unavailable'},503)
 const eligible=(catalog.data||[]).filter(x=>typeof x.release_title==='string'&&x.release_title.length>0)
 if(!eligible.length)return json({error:'No catalog-based candidates found'},404)
 // Stable deterministic selection, not engagement analysis or artist endorsement.
 const index=Number(b.month.slice(0,4))*12+Number(b.month.slice(5,7))
 const chosen=eligible[index%eligible.length]
 const proposalKey='inventory-music-'+b.month
 const row={
  proposal_key:proposalKey,proposed_month:b.month,performance_type:'music',
  title:'Catalog spotlight: '+chosen.release_title,
  description:'Private programming idea based solely on the existing DistroKid-derived release inventory. Artist and track identifiers, assets, rights, release status, and performance readiness require verification. This is not a confirmed event.',
  production_brief:'Evaluate a virtual Café Sativa performance or listening-room feature for '+chosen.release_title+'. Before any budget or production: verify mastered audio, permitted voices and likenesses, stems, asset provenance, canonical stage, storyboard and explicit owner approval. Do not render or schedule without further approval.',
  artist_name:chosen.artist_name,source_catalog_id:chosen.id,
  source_evidence:[{kind:'internal_release_inventory',catalogId:chosen.id,releaseTitle:chosen.release_title,catalogStatus:chosen.catalog_status,streamingStatus:chosen.streaming_status,reportedTrackCount:chosen.reported_track_count,engagementEvidence:false,externallyVerified:false}],
  source_type:'inventory',confidence:'low',status:'draft'
 }
 const inserted=await db.from('cs_programming_proposals').insert(row).select('id,title,status,proposed_month').single()
 if(inserted.error)return json({error:inserted.error.code==='23505'?'The month already has a concept proposal':'Could not save private recommendation'},inserted.error.code==='23505'?409:503)
 return json({proposal:inserted.data,evidenceScope:'internal release inventory only',engagementAnalyzed:false,publicEventCreated:false,productionApproved:false,renderingStarted:false,publishingStarted:false},201)
}
