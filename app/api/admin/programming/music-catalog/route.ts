import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const db=createAdminClient()
 const [releases,tracks]=await Promise.all([
  db.from('cs_music_catalog').select('id,release_title,artist_name,release_type,reported_track_count,catalog_status,streaming_status,source,release_date,isrc,upc,source_note').order('release_title').limit(500),
  db.from('cs_music_tracks').select('catalog_id,track_number,title,featured_artist,eligibility').limit(1000)
 ])
 if(releases.error||tracks.error)return NextResponse.json({error:'Catalog temporarily unavailable'},{status:503,headers})
 return NextResponse.json({releases:releases.data||[],tracks:tracks.data||[],note:'Unverified inventory references are for private analysis only; actual performance eligibility requires verified track metadata and authorized assets. No events, renders, or publishing are triggered.'},{headers})
}
