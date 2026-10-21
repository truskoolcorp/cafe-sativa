import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const db=createAdminClient()
 const [drafts,plans,qa]=await Promise.all([
  db.from('cs_character_promo_drafts').select('id,character_id,promo_key,title,status,intended_channel,actual_social_account,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at,linked_event_id').order('created_at',{ascending:false}).limit(100),
  db.from('cs_character_promo_delivery_plans').select('promo_id,network,account_id,status,scheduled_at,provider_receipt').limit(100),
  db.from('cs_character_promo_qa_checks').select('promo_id,video_sha256,check_name,result').limit(1000)
 ])
 if(drafts.error||plans.error||qa.error)return NextResponse.json({error:'Promotion readiness sources unavailable'},{status:503,headers})
 const work=(drafts.data||[]).map(d=>{
  const targets=(plans.data||[]).filter(p=>p.promo_id===d.id)
  const blockers:string[]=[]
  const expectedChecks=['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety']
  const sha=d.video_asset_path?.match(/\/([a-f0-9]{64})\.mp4$/)?.[1]||null
  const observations=(qa.data||[]).filter(q=>q.promo_id===d.id&&q.video_sha256===sha)
  const seen=observations.filter(q=>q.result==='pass')
  const pendingChecks=expectedChecks.filter(name=>!seen.some(q=>q.check_name===name))
  if(!sha||pendingChecks.length)blockers.push('Complete passing QA observations for this exact video hash are missing')
  if(!['script_approved'].includes(d.status))blockers.push('Spoken script has not passed the canonical approval gate')
  if(d.character_id!=='keith'&&d.intended_channel==='character_profile_unconfirmed')blockers.push('Dedicated character account is not connected')
  if(d.character_id==='keith'&&d.intended_channel!=='truskoolcorp_metricool_brand_5373515')blockers.push('Incorrect corporate brand routing')
  if(!d.actual_social_account)blockers.push('Exact authorized social account not mapped')
  if(!d.voice_approved_at)blockers.push(d.video_asset_path?'Embedded speech owner-attested; canonical voice verification and final audio approval still pending':'Canonical audio not verified')
  if(d.voice_approved_at&&!d.audio_asset_path)blockers.push('Embedded audio needs a recorded extraction or verification receipt; separate MP3 is not mandatory')
  if(!d.video_asset_path||!d.video_qa_approved_at)blockers.push('Video asset and QA not verified')
  if(!d.publication_approved_at)blockers.push('Content publication authorization missing')
  if(!targets.length)blockers.push('No verified provider delivery plan')
  if(targets.some(t=>!t.account_id))blockers.push('Provider destination is unknown')
  if(targets.some(t=>t.status!=='ready_for_delivery'))blockers.push('Delivery plan is not cleared for a new scheduling action')
  if(targets.some(t=>t.status==='confirmed'&&!t.provider_receipt))blockers.push('Confirmed delivery lacks provider receipt')
  return {id:d.id,title:d.title,characterId:d.character_id,status:d.status,qaProgress:{passed:seen.length,total:expectedChecks.length,pending:pendingChecks,recorded:observations.length},embeddedAudioPermitted:true,ready:!blockers.length,blockers,targets:targets.map(t=>({network:t.network,status:t.status,scheduledAt:t.scheduled_at,hasProviderReceipt:!!t.provider_receipt}))}
 })
 return NextResponse.json({primaryCorporatePersona:'keith',corporateMetricoolBrandId:5373515,analyticsScope:'Tru Skool corporate accounts only',publicationsTriggered:false,paidRendersTriggered:false,readyCount:work.filter(p=>p.ready).length,items:work},{headers})
}
