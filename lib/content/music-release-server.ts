import 'server-only'
import {createHash} from 'node:crypto'
import {createAdminClient} from '@/lib/supabase/admin'
import {withSocialConnection} from './social-connection'
import {socialCreateArguments,socialPostMatches,verifiedSocialPublication} from './social-contract'
import {approvedRelease,MediaRef,MusicRelease,replayRow,releaseDigest} from './music-release-contract'
const MAX_BYTES=50*1024*1024
export async function verifiedMusicBytes(db:ReturnType<typeof createAdminClient>,ref:MediaRef){
 const bucket=await db.storage.getBucket(ref.bucket)
 if(bucket.error||!bucket.data||bucket.data.public)throw Error('Private storage required')
 const parts=ref.path.split('/'),name=parts.pop()!
 const info=await db.storage.from(ref.bucket).list(parts.join('/')||undefined,{search:name,limit:100})
 const obj=info.data?.find(o=>o.name===name&&o.id)
 if(info.error||!obj||!obj.metadata?.size||obj.metadata.size>MAX_BYTES)throw Error('Stored MP4 unavailable or exceeds 50 MB')
 const file=await db.storage.from(ref.bucket).download(ref.path)
 if(file.error||!file.data||file.data.size>MAX_BYTES)throw Error('Media read failed')
 const bytes=Buffer.from(await file.data.arrayBuffer())
 if(!bytes.length||createHash('sha256').update(bytes).digest('hex')!==ref.sha256||bytes.subarray(4,8).toString()!=='ftyp')throw Error('Media bytes differ from reviewed MP4')
 return bytes
}
export async function processMusicReleases(){
 const db=createAdminClient(),now=Date.now()
 // A timed-out submission is ambiguous, never permission to resubmit.
 const stale=await db.from('cs_music_releases').update({marketing_state:'unknown',marketing_error:'Submission interrupted; reconcile in Metricool before retrying.'}).eq('marketing_state','submitting').lt('submitted_at',new Date(now-600000).toISOString())
 if(stale.error)throw stale.error
 const found=await db.from('cs_music_releases').select('*').eq('status','approved').or('vip_ready.eq.false,marketing_state.in.(queued,scheduled,unknown)').order('created_at').limit(50)
 if(found.error)throw found.error
 let archived=0
 for(const row of found.data||[]){
  if(!approvedRelease(row))continue
  if(!row.vip_ready){
   try{
    await verifiedMusicBytes(db,row.manifest.master)
    const expected=replayRow(row)
    const saved=await db.from('cs_vip_recordings').upsert(expected,{onConflict:'id',ignoreDuplicates:true})
    if(saved.error)throw saved.error
    const existing=await db.from('cs_vip_recordings').select('*').eq('id',row.id).single()
    if(existing.error||Object.entries(expected).some(([k,v])=>['release_at','approved_at'].includes(k)?Date.parse(existing.data[k])!==Date.parse(String(v)):existing.data[k]!==v))throw Error('Replay identity mismatch')
    const done=await db.from('cs_music_releases').update({vip_ready:true,vip_error:null}).eq('id',row.id).eq('digest',row.digest)
    if(done.error)throw done.error
    archived++
   }catch{await db.from('cs_music_releases').update({vip_error:'Private master could not be verified or registered; no membership access claimed.'}).eq('id',row.id)}
  }
 }
 // New queues must not starve behind old receipts absent from the provider's pending feed.
 const queued=await db.from('cs_music_releases').select('*').eq('status','approved').eq('marketing_state','queued').order('created_at').limit(1)
 if(queued.error)throw queued.error
 const candidates=[...(queued.data||[]),...(found.data||[])].filter(r=>approvedRelease(r)&&['queued','scheduled','unknown'].includes(r.marketing_state))
 if(!candidates.length)return {archived,marketing:'idle'}
 return withSocialConnection(async({session,brand,enabled})=>{
  let reconciled=0
  const row=candidates.find(r=>r.marketing_state==='queued')||candidates.filter(r=>!r.checked_at||Date.parse(r.checked_at)<now-3600000).sort((a,b)=>Date.parse(a.checked_at||'1970-01-01')-Date.parse(b.checked_at||'1970-01-01'))[0]
  if(!row)return {archived,marketing:'idle'}
  const m=row.manifest as MusicRelease
  const window={brandId:'5373515',fromDate:new Date(Date.parse(m.scheduledAt)-86400000).toISOString(),toDate:new Date(Date.parse(m.scheduledAt)+86400000).toISOString(),timezone:brand.timezone,extendedRange:false}
  const list=await session.call('getScheduledPosts',window)
  const posts=Array.isArray(list)?list:list.data
  if(!Array.isArray(posts))throw Error('Invalid scheduling response')
  const exact=posts.filter((p:any)=>socialPostMatches(p,{caption:m.caption,scheduled_at:m.scheduledAt},brand.timezone))
  if(row.marketing_state!=='queued'){
   const receipt=row.marketing_receipt
   const post=exact.find((p:any)=>String(p.uuid)===String(receipt?.uuid)&&String(p.id)===String(receipt?.id))
   const publication=post&&verifiedSocialPublication(post,{caption:m.caption,scheduled_at:m.scheduledAt,provider_uuid:receipt?.uuid,provider_post_id:receipt?.id},brand.timezone)
   const update=await db.from('cs_music_releases').update({checked_at:new Date().toISOString(),marketing_receipt:{...receipt,...(publication||{}),observation:publication?'Publication confirmed':'Publication remains unconfirmed; no resubmission'}}).eq('id',row.id).eq('marketing_state',row.marketing_state)
   if(update.error)throw update.error
   reconciled++;return {archived,reconciled,marketing:row.marketing_state}
  }
  if(!enabled)return {archived,marketing:'dispatch_disabled'}
  if(Date.parse(m.scheduledAt)<now+60000||exact.length){
   await db.from('cs_music_releases').update({marketing_state:'blocked',marketing_error:'Release time passed or matching schedule already exists; review instead of duplicating.'}).eq('id',row.id).eq('marketing_state','queued')
   return {archived,marketing:'blocked'}
  }
  await verifiedMusicBytes(db,m.teaser)
  const owner=await db.auth.admin.getUserById(row.approved_by)
  if(owner.error||owner.data.user?.app_metadata?.cafe_sativa_admin!==true)throw Error('Release approver no longer authorized')
  const fresh=await db.from('cs_music_releases').select('*').eq('id',row.id).single()
  if(fresh.error||!approvedRelease(fresh.data)||releaseDigest(fresh.data.manifest)!==row.digest)throw Error('Approval changed')
  const claim=await db.from('cs_music_releases').update({marketing_state:'submitting',submitted_at:new Date().toISOString()}).eq('id',row.id).eq('marketing_state','queued').select('id').maybeSingle()
  if(claim.error)throw claim.error
  if(!claim.data)return {archived,marketing:'already_claimed'}
  try{
   const args=socialCreateArguments({caption:m.caption,scheduled_at:m.scheduledAt},brand.timezone,`https://www.cafe-sativa.com/api/music/teaser/${row.id}`)
   await session.call('createScheduledPost',args)
   const after=await session.call('getScheduledPosts',window)
   const matches=(Array.isArray(after)?after:after.data)?.filter((p:any)=>socialPostMatches(p,{caption:m.caption,scheduled_at:m.scheduledAt},brand.timezone)&&p.autoPublish===true&&p.draft===false&&p.id&&p.uuid&&p.media?.length&&p.media.every((s:any)=>typeof s==='string'&&s.startsWith('https://static.metricool.com/')))
   if(!Array.isArray(matches)||matches.length!==1)throw Error('Ambiguous submission')
   const post=matches[0]
   const saved=await db.from('cs_music_releases').update({marketing_state:'scheduled',marketing_error:null,checked_at:new Date().toISOString(),marketing_receipt:{id:post.id,uuid:post.uuid,publicationDate:post.publicationDate,providers:post.providers,observation:'Scheduling confirmed; publication not yet confirmed'}}).eq('id',row.id).eq('marketing_state','submitting')
   if(saved.error)throw saved.error
   return {archived,marketing:'scheduled'}
  }catch{
   await db.from('cs_music_releases').update({marketing_state:'unknown',marketing_error:'Submission may have reached Metricool. Inspect before any retry.'}).eq('id',row.id).eq('marketing_state','submitting')
   return {archived,marketing:'unknown'}
  }
 })
}
