import {NextRequest,NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
import {normalizeRelease,releaseDigest,UUID} from '@/lib/content/music-release-contract'
import {verifiedMusicBytes} from '@/lib/content/music-release-server'
export const dynamic='force-dynamic'
export const maxDuration=60
const reply=(body:any,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET(){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 const result=await createAdminClient().from('cs_music_releases').select('*').order('created_at',{ascending:false}).limit(100)
 if(result.error)return reply({error:'Release inventory unavailable'},503)
 const payments=await createAdminClient().from('cs_music_conversions').select('release_id,amount_cents').limit(1000)
 return reply({releases:result.data,initialPaidCheckouts:payments.error?null:payments.data,note:'Initial paid checkouts only; not net revenue or recurring revenue.'})
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return reply({error:'Unauthorized'},401)
 if(req.headers.get('origin')!==req.nextUrl.origin)return reply({error:'Invalid origin'},403)
 const raw=await req.text();if(raw.length>16384)return reply({error:'Request too large'},413)
 let body:any;try{body=JSON.parse(raw)}catch{return reply({error:'Invalid JSON'},400)}
 const db=createAdminClient(),{data:{user}}=await createClient().auth.getUser()
 if(!user||user.app_metadata?.cafe_sativa_admin!==true)return reply({error:'Unauthorized'},401)
 try{
  if(body.action==='prepare'){
   const manifest=normalizeRelease(body.manifest)
   await verifiedMusicBytes(db,manifest.teaser);await verifiedMusicBytes(db,manifest.master)
   const digest=releaseDigest(manifest)
   const saved=await db.from('cs_music_releases').insert({slug:manifest.slug,manifest,digest,created_by:user.id}).select('id,digest,status').single()
   if(saved.error)return reply({error:saved.error.code==='23505'?'Release slug already registered':'Could not prepare release'},saved.error.code==='23505'?409:503)
   return reply(saved.data)
  }
  if(body.action!=='approve'||!UUID.test(body.id)||!/^[a-f0-9]{64}$/.test(body.digest)||!['face','lipSync','audio','wardrobe','watermarks','publicTeaser','vipMaster','caption','destinations','schedule'].every(k=>body.checks?.[k]===true))return reply({error:'Complete release and destination review required'},400)
  const found=await db.from('cs_music_releases').select('*').eq('id',body.id).single()
  if(found.error||!found.data)return reply({error:'Release not found'},404)
  const row=found.data
  if(row.status!=='draft'||row.digest!==body.digest||releaseDigest(row.manifest)!==body.digest)return reply({error:'Release changed; refresh review'},409)
  // Revalidate lead time without appending the CTA twice.
  if(Date.parse(row.manifest.scheduledAt)<Date.now()+1800000)return reply({error:'Choose a fresh draft with at least 30 minutes lead time'},409)
  await verifiedMusicBytes(db,row.manifest.teaser);await verifiedMusicBytes(db,row.manifest.master)
  const saved=await db.from('cs_music_releases').update({status:'approved',approved_by:user.id,approved_at:new Date().toISOString()}).eq('id',row.id).eq('status','draft').eq('digest',body.digest).select('id,status').maybeSingle()
  if(saved.error||!saved.data)return reply({error:'Release state changed'},409)
  return reply({...saved.data,handoff:'queued',destinations:['Tru Skool Facebook','Tru Skool Threads','Café Sativa VIP replay library'],payment:'Existing membership checkout; no charge created'})
 }catch{return reply({error:'Media validation or handoff failed; no release approval saved'},422)}
}
