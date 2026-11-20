import {createAdminClient} from '@/lib/supabase/admin'
import {approvedRelease,UUID} from '@/lib/content/music-release-contract'
import {verifiedMusicBytes} from '@/lib/content/music-release-server'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(_req:Request,{params}:{params:{id:string}}){
 if(!UUID.test(params.id))return new Response(null,{status:404})
 const db=createAdminClient(),row=await db.from('cs_music_releases').select('*').eq('id',params.id).maybeSingle()
 // Explicit release approval includes making ONLY the teaser fetchable by social delivery.
 if(row.error||!approvedRelease(row.data))return new Response(null,{status:404})
 try{
  const bytes=await verifiedMusicBytes(db,row.data.manifest.teaser)
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(bytes));c.close()}})
  return new Response(stream,{headers:{'Content-Type':'video/mp4','Cache-Control':'no-store','Content-Length':String(bytes.length),'X-Content-Type-Options':'nosniff'}})
 }catch{return new Response(null,{status:503})}
}
