import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const HEADERS={'Cache-Control':'private, no-store'}
const MAX=100
function captionFor(title:string,script:string,network:string){
 const cta='Explore the virtual Café Sativa concept: https://cafe-sativa.com'
 const lead=script.replace(/\s+/g,' ').trim()
 const base=network==='threads'?lead:network==='facebook'?title+' — '+lead:lead
 const cap=base+'\n\n'+cta+'\n\n#CafeSativa #TruSkool'
 const max=network==='threads'?500:network==='facebook'?2000:300
 return cap.length<=max?cap:cap.slice(0,max-3)+'...'
}
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers:HEADERS})
 const db=createAdminClient()
 const [promos,plans]=await Promise.all([
  db.from('cs_character_promo_drafts').select('id,character_id,title,spoken_script,status,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at').order('created_at',{ascending:false}).limit(MAX),
  db.from('cs_character_promo_delivery_plans').select('id,promo_id,network,account_id,status,scheduled_at').order('scheduled_at',{ascending:true}).limit(MAX)
 ])
 if(promos.error||plans.error)return NextResponse.json({error:'Scheduling evidence unavailable'},{status:503,headers:HEADERS})
 const byId=new Map((promos.data||[]).map(p=>[p.id,p]))
 const suggestions=(plans.data||[]).map(plan=>{
  const draft=byId.get(plan.promo_id)
  const issues:string[]=[]
  if(!draft)issues.push('Missing associated promo draft')
  if(draft?.status!=='script_approved')issues.push('Unapproved spoken script')
  if(!draft?.video_asset_path||!draft?.video_qa_approved_at)issues.push('Approved finished video missing')
  if(!draft?.audio_asset_path||!draft?.voice_approved_at)issues.push('Approved voice audio missing')
  if(!draft?.publication_approved_at)issues.push('Publication gate not satisfied')
  if(!plan.account_id)issues.push('Verified destination account missing')
  if(plan.status!=='ready_for_delivery')issues.push('Delivery plan not cleared')
  return {id:plan.id,promoId:plan.promo_id,characterId:draft?.character_id||null,network:plan.network,proposedAt:plan.scheduled_at,status:plan.status,caption:draft?captionFor(draft.title,draft.spoken_script,plan.network):null,readyToSchedule:issues.length===0,issues}
 })
 return NextResponse.json({suggestions,automatedSchedulingEnabled:false,noPostsChanged:true,analysisScope:'Internal concepts and proposed slots only, no engagement optimization or provider booking',note:'Generated captions are proposals and do not grant rights, QA, or publishing approval.'},{headers:HEADERS})
}
