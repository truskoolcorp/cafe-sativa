import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers})
const enabled=()=>process.env.CS_MUSICBRAINZ_COMMERCIAL_ACCESS_APPROVED==='true'
export async function GET(){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 const db=createAdminClient()
 const [inventory,candidates]=await Promise.all([
  db.from('cs_music_catalog').select('id,release_title,artist_name,catalog_status,source').limit(500),
  db.from('cs_music_metadata_matches').select('catalog_id,provider,provider_entity_id,provider_entity_type,match_status,match_confidence,observed_at').limit(1000)
 ])
 if(inventory.error||candidates.error)return reply({error:'Catalog unavailable'},503)
 return reply({enabled:enabled(),automatedSyncEnabled:false,provider:'musicbrainz',requiresCommercialTermsVerification:!enabled(),releaseCount:(inventory.data||[]).length,verifiedMatches:(candidates.data||[]).filter(x=>x.match_status==='verified').length,candidates:candidates.data||[],note:'Read-only reconciliation status. Discovery cannot run until authorized commercial API access is explicitly configured. No publishing or paid rendering.'})
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 if(!enabled())return reply({error:'MusicBrainz discovery disabled pending confirmation of commercial-use authorization. No external request sent.'},423)
 // Discovery previews are never persisted as verified facts.
 const b=await req.json().catch(()=>null)
 if(!b||typeof b.artist!=='string'||typeof b.title!=='string'||b.artist.length>120||b.title.length>180||!b.artist.trim()||!b.title.trim())return reply({error:'Provide artist and release title'},400)
 const escape=(s:string)=>s.replace(/[\\":]/g,' ').trim()
 const query='artist:"'+escape(b.artist)+'" AND release:"'+escape(b.title)+'"'
 const url='https://musicbrainz.org/ws/2/release/?fmt=json&limit=5&query='+encodeURIComponent(query)
 try{
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(7000),headers:{'User-Agent':'CafeSativaCatalog/0.1 (https://www.cafe-sativa.com; admin metadata verification)','Accept':'application/json'}})
  if(!response.ok)return reply({error:'MusicBrainz lookup unavailable',status:response.status},502)
  const payload=await response.json() as {releases?:Array<{id?:string;title?:string;date?:string;barcode?:string;score?:number}>}
  return reply({mode:'preview_only',stored:false,requiresOwnerMatchReview:true,results:(payload.releases||[]).slice(0,5).map(x=>({mbid:x.id,title:x.title,date:x.date,barcode:x.barcode,searchScore:x.score})),note:'These are unverified candidates and must not populate verified catalog metadata without separate review.'})
 }catch{return reply({error:'MusicBrainz discovery request failed'},502)}
}
