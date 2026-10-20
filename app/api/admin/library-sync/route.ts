import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
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
 const escaped=tag.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')
 const value=new RegExp('<'+escaped+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+escaped+'>','i').exec(xml)?.[1]
 if(!value)return ''
 return value.replace(/^<!\[CDATA\[|\]\]>$/g,'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim()
}
export async function POST(req:NextRequest){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
 const db=createAdminClient()
 let imported=0,existing=0,skipped=0
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
   try{link=new URL(raw)}catch{skipped++;continue}
   const id=link.pathname.match(/^\/episodes\/([0-9a-f-]{36})\/?$/i)?.[1]
   const date=field(entry,'pubDate')
   const published=new Date(date)
   if(!id||!uuid.test(id)||link.protocol!=='https:'||link.hostname!==show.host||!title||!Number.isFinite(published.getTime())||published.getTime()>Date.now()){skipped++;continue}
   const description=field(entry,'description').slice(0,1500)
   // Unique provider ID makes repeat syncs safe and preserves owner edits.
   const found=await db.from('cs_member_library').select('id').eq('source_provider','jellypod').eq('source_external_id',id).maybeSingle()
   if(found.error)return NextResponse.json({error:'Unable to check existing entries',imported,existing,skipped},{status:503})
   if(found.data){existing++;continue}
   const result=await db.from('cs_member_library').upsert({
    kind:'podcast',title,description,external_url:link.href,source_provider:'jellypod',source_external_id:id,
    status:'published',approved_at:published.toISOString(),published_at:published.toISOString()
   },{onConflict:'source_provider,source_external_id',ignoreDuplicates:true})
   if(result.error)return NextResponse.json({error:'Podcast import failed',imported,existing,skipped},{status:503})
   imported++
  }
 }
 return NextResponse.json({imported,existing,skipped,feeds:SHOWS.length},{headers:{'Cache-Control':'private, no-store'}})
}
