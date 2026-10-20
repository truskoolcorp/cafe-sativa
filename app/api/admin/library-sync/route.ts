import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin, cronAuthorized } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export const maxDuration=60
// Only these approved public Jellypod shows may populate Café Sativa's library.
const SHOWS=[
 {feed:'https://what-are-you-smoking-j901vv.jellypod.com/rss',host:'what-are-you-smoking-j901vv.jellypod.com'},
 {feed:'https://caf-sativa-sip-smoke-vibe-0no2b3.jellypod.com/rss',host:'caf-sativa-sip-smoke-vibe-0no2b3.jellypod.com'}
] as const
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function field(xml:string,tag:string){
 // Only fixed internal RSS tag names are passed here.
 const value=new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i').exec(xml)?.[1]
 if(!value)return ''
 return value.replace(/^<!\[CDATA\[|\]\]>$/g,'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim()
}

async function syncApprovedFeeds(){
 const db=createAdminClient()
 let imported=0,existing=0,skipped=0
 const skipReasons:Record<string,number>={}
 const skip=(reason:string)=>{skipped++;skipReasons[reason]=(skipReasons[reason]||0)+1}
 for(const show of SHOWS){
  let feed:string
  try {
   const res=await fetch(show.feed,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)})
   if(!res.ok||!(res.headers.get('content-type')||'').match(/xml|rss|text\/plain/))throw Error('Invalid public RSS response')
   feed=await res.text()
   if(feed.length>2_000_000||!feed.includes('<rss'))throw Error('Invalid RSS')
  }catch{return NextResponse.json({error:'A Café Sativa podcast feed could not be verified; no further imports attempted.',imported,existing,skipped},{status:503})}
  const items=[...feed.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,100)
  for(const match of items){
   const entry=match[1],title=field(entry,'title').slice(0,240),raw=field(entry,'link')
   let link:URL
   try{link=new URL(raw)}catch{skip('invalid_link');continue}
   const id=link.pathname.match(/^\/episodes\/([0-9a-f-]{36})\/?$/i)?.[1]
   const date=field(entry,'pubDate')
   const published=new Date(date)
   if(!id||!uuid.test(id)){skip('episode_id_format');continue}
   if(link.protocol!=='https:'||link.hostname!==show.host){skip('untrusted_link_origin');continue}
   if(!title){skip('missing_title');continue}
   if(!Number.isFinite(published.getTime())){skip('missing_or_invalid_date');continue}
   if(published.getTime()>Date.now()){skip('future_publication');continue}
   const description=field(entry,'description').slice(0,1500)
   // Unique provider ID makes repeat syncs safe and preserves owner edits.
   const found=await db.from('cs_member_library').select('id').eq('source_provider','jellypod').eq('source_external_id',id).maybeSingle()
   if(found.error)return NextResponse.json({error:'Unable to check existing entries',imported,existing,skipped},{status:503})
   if(found.data){existing++;continue}
   const result=await db.from('cs_member_library').insert({
    kind:'podcast',title,description,external_url:link.href,source_provider:'jellypod',source_external_id:id,
    status:'published',approved_at:published.toISOString(),published_at:published.toISOString()
   })
   if(result.error){if(result.error.code==='23505'){existing++;continue}return NextResponse.json({error:'Podcast import failed',imported,existing,skipped},{status:503})}
   imported++
  }
 }
 return NextResponse.json({imported,existing,skipped,skipReasons,feeds:SHOWS.length},{headers:{'Cache-Control':'private, no-store'}})
}

async function runTracked(trigger:'admin'|'cron'){
 const db=createAdminClient()
 const receipt=await db.from('cs_podcast_sync_receipts').insert({trigger,state:'running'}).select('id').single()
 if(receipt.error||!receipt.data){console.error('[podcast-sync] receipt-create failed',receipt.error?.code||'missing_record');return NextResponse.json({error:'Unable to begin auditable sync'},{status:503})}
 try{
  const result=await syncApprovedFeeds()
  const body=await result.clone().json()
  const success=result.ok
  console.info('[podcast-sync] feed-check completed',{trigger,success,imported:body.imported||0,existing:body.existing||0,skipped:body.skipped||0,skipReasons:body.skipReasons||{}})
  const saved=await db.from('cs_podcast_sync_receipts').update({
   state:success?'succeeded':'failed',finished_at:new Date().toISOString(),
   imported:body.imported||0,existing:body.existing||0,skipped:body.skipped||0,
   checked_feeds:success?SHOWS.length:0,error_code:!success?'feed_or_import_failed':body.skipped>0&&body.imported===0&&body.existing===0?'entries_rejected':null
  }).eq('id',receipt.data.id)
  if(saved.error){console.error('[podcast-sync] receipt-save failed',saved.error.code);return NextResponse.json({error:'Sync ran but its audit receipt could not be saved; check catalog before retrying.'},{status:503})}
  return NextResponse.json({...body,receiptId:receipt.data.id},{status:result.status,headers:{'Cache-Control':'private, no-store'}})
 }catch(error){
  await db.from('cs_podcast_sync_receipts').update({state:'failed',finished_at:new Date().toISOString(),error_code:'unexpected'}).eq('id',receipt.data.id)
  console.error('[podcast-sync] unexpected failure',error instanceof Error?error.message:'unknown')
  return NextResponse.json({error:'Podcast sync failed; see audit receipt',receiptId:receipt.data.id},{status:503})
 }
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
 return runTracked('admin')
}
export async function GET(req:NextRequest){
 if(!cronAuthorized(req.headers.get('authorization')))return NextResponse.json({error:'Unauthorized'},{status:401})
 return runTracked('cron')
}
