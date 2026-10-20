import { NextRequest,NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
export async function GET(req:NextRequest){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const month=req.nextUrl.searchParams.get('month')||new Date().toISOString().slice(0,7)
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return NextResponse.json({error:'Invalid month'},{status:400,headers})
 const start=month+'-01T00:00:00.000Z'
 const [year,mon]=month.split('-').map(Number)
 const end=new Date(Date.UTC(year,mon,1)).toISOString()
 try {
  const db=createAdminClient()
  const [events,jobs,content,social]=await Promise.all([
   db.from('events').select('id,title,starts_at,status,category,presenter_name').gte('starts_at',start).lt('starts_at',end).order('starts_at').limit(150),
   db.from('cs_content_jobs').select('id,title,room,status,created_at,output_url,blocker').gte('created_at',start).lt('created_at',end).order('created_at').limit(150),
   db.from('content_items').select('id,title,channel,agent,status,scheduled_at,created_at').gte('scheduled_at',start).lt('scheduled_at',end).order('scheduled_at').limit(150),
   db.from('cs_social_deliveries').select('id,state,scheduled_at,caption,provider_post_id,receipt,error').gte('scheduled_at',start).lt('scheduled_at',end).order('scheduled_at').limit(150)
  ])
  if(events.error||jobs.error||content.error||social.error)throw Error('Sources unavailable')
  const videos=await Promise.all((jobs.data||[]).map(async j=>{
    let previewUrl:null|string=null
    if(/^[0-9a-f-]{36}\.mp4$/i.test(j.output_url||'')){
      const signed=await db.storage.from('cafe-sativa-content').createSignedUrl(j.output_url,600)
      previewUrl=signed.data?.signedUrl||null
    }
    return {...j,previewUrl}
  }))
  return NextResponse.json({month,events:events.data||[],videoJobs:videos,scheduledContent:content.data||[],socialReceipts:(social.data||[]).map(r=>({id:r.id,state:r.state,scheduled_at:r.scheduled_at,caption:r.caption,provider_post_id:r.provider_post_id,providers:Array.isArray(r.receipt?.providers)?r.receipt.providers.map((p:{network?:string;status?:string;publicUrl?:string})=>({network:p.network||null,status:p.status||null,publicUrl:typeof p.publicUrl==='string'&&p.publicUrl.startsWith('https://')?p.publicUrl:null})):[],observation:r.receipt?.observation||null,error:r.error||null})),notes:{videoDate:'Video jobs are organized by creation date, not a confirmed release date.',character:'Character-specific video production is not yet represented as a separate verified catalog.',social:'Website-recorded Metricool delivery receipts are included as historical evidence. Posts created directly in Metricool may be absent while OAuth is unavailable.'}},{headers})
 }catch{return NextResponse.json({error:'Programming data temporarily unavailable'},{status:503,headers})}
}
