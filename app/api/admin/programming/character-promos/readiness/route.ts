import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const db=createAdminClient()
 const [drafts,plans]=await Promise.all([
  db.from('cs_character_promo_drafts').select('id,character_id,promo_key,title,status,intended_channel,actual_social_account,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at,linked_event_id').order('created_at',{ascending:false}).limit(100),
  db.from('cs_character_promo_delivery_plans').select('promo_id,network,account_id,status,scheduled_at,provider_receipt').limit(100)
 ])
 if(drafts.error||plans.error)return NextResponse.json({error:'Promotion readiness sources unavailable'},{status:503,headers})
 const work=(drafts.data||[]).map(d=>{
  const targets=(plans.data||[]).filter(p=>p.promo_id===d.id)
  const blockers:string[]=[]
  if(d.character_id!=='keith'&&d.intended_channel==='character_profile_unconfirmed')blockers.push('Dedicated character account is not connected')
  if(d.character_id==='keith'&&d.intended_channel!=='truskoolcorp_metricool_brand_5373515')blockers.push('Incorrect corporate brand routing')
  if(!d.actual_social_account)blockers.push('Exact authorized social account not mapped')
  if(!d.audio_asset_path||!d.voice_approved_at)blockers.push('Canonical audio not verified')
  if(!d.video_asset_path||!d.video_qa_approved_at)blockers.push('Video asset and QA not verified')
  if(!d.publication_approved_at)blockers.push('Content publication authorization missing')
  if(!targets.length)blockers.push('No verified provider delivery plan')
  if(targets.some(t=>!t.account_id))blockers.push('Provider destination is unknown')
  return {id:d.id,title:d.title,characterId:d.character_id,status:d.status,ready:!blockers.length,blockers,targets:targets.map(t=>({network:t.network,status:t.status,scheduledAt:t.scheduled_at,hasProviderReceipt:!!t.provider_receipt}))}
 })
 return NextResponse.json({primaryCorporatePersona:'keith',corporateMetricoolBrandId:5373515,analyticsScope:'Tru Skool corporate accounts only',publicationsTriggered:false,paidRendersTriggered:false,readyCount:work.filter(p=>p.ready).length,items:work},{headers})
}
