import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const db=createAdminClient()
 const [jobs,posts,library,events]=await Promise.all([
  db.from('cs_content_jobs').select('id,room,status,created_at').order('created_at',{ascending:false}).limit(150),
  db.from('cs_social_deliveries').select('id,state,scheduled_at,receipt').order('scheduled_at',{ascending:false}).limit(150),
  db.from('cs_member_library').select('id,kind,title,status,approved_at,published_at').eq('status','published').not('approved_at','is',null).limit(150),
  db.from('events').select('id,status,starts_at').gte('starts_at',new Date().toISOString()).limit(150)
 ])
 if(jobs.error||posts.error||library.error||events.error)return NextResponse.json({error:'Analysis sources unavailable'},{status:503,headers})
 const roomCounts:Record<string,{jobs:number;approved:number}>={}
 for(const j of jobs.data||[]){
  const room=j.room||'unknown';roomCounts[room]??={jobs:0,approved:0};roomCounts[room].jobs++
  if(['approved','scheduled','published'].includes(j.status))roomCounts[room].approved++
 }
 const social=(posts.data||[]).map(p=>({state:p.state,providerStatuses:Array.isArray(p.receipt?.providers)?p.receipt.providers.map((v:{status?:string})=>v.status||'unknown'):[]}))
 const publishedSocial=social.filter(p=>p.providerStatuses.length>0&&p.providerStatuses.every(x=>x.toUpperCase()==='PUBLISHED')).length
 const libraryByKind={podcasts:(library.data||[]).filter((x:{kind:string})=>x.kind==='podcast').length,recipes:(library.data||[]).filter((x:{kind:string})=>x.kind==='recipe').length}
 const evidence=[{source:'cs_content_jobs',observedAt:new Date().toISOString(),finding:'Observed venue production job counts and approved-stage counts, not audience demand',metric:(jobs.data||[]).length}]
 const proposals=[]
 if((jobs.data||[]).length>0 && (events.data||[]).length===0)proposals.push({key:'programming-gap-review',title:'Review programming opportunities against confirmed event inventory',confidence:'low',status:'suggested',analyst:'Anya / OC',concierge:'Laviche',owner:'Keith',whyNow:'There are venue production records but no upcoming event records in the queried horizon. This is an inventory gap, not proof of audience demand.',evidence,missingSignals:['Audience attendance and demand','Confirmed hosts and dates'],mayPublish:false})
 return NextResponse.json({generatedAt:new Date().toISOString(),analysisMode:'descriptive_inventory_only',signals:{venueJobsByRoom:roomCounts,publishedSocialReceipts:publishedSocial,websiteLibrary:libraryByKind,upcomingEventRecords:(events.data||[]).length},proposals,limitations:['No audience behavior or retention analytics connected','No performance-based ranking or predictive engagement model','Source queries capped at 150 records each','Suggestions are not approved events, renders or publications']},{headers})
}
