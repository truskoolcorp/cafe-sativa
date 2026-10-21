import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function GET(){
 const headers={'Cache-Control':'private, no-store'}
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401,headers})
 const db=createAdminClient()
 const [drafts,plans]=await Promise.all([
  db.from('cs_character_promo_drafts').select('id,character_id,specialty,title,spoken_script,visual_brief,duration_seconds,status,evidence,actual_social_account,audio_asset_path,video_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at,created_at').order('created_at',{ascending:false}).limit(100),
  db.from('cs_character_promo_delivery_plans').select('id,promo_id,network,account_id,scheduled_at,status,provider_receipt').order('scheduled_at',{ascending:true}).limit(100)
 ])
 if(drafts.error||plans.error)return NextResponse.json({error:'Promo records unavailable'},{status:503,headers})
 return NextResponse.json({drafts:drafts.data,plans:plans.data,automatedPublishingActive:false,paidGenerationActive:false,requirements:['verified canonical media','authorized mapped account','approved QA','provider delivery receipts']},{headers})
}
