import { NextRequest, NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { planSiteContent, publishDueSiteContent, siteMediaApproved } from '@/lib/content/site'
import { planApprovedClipFeatures } from '@/lib/content/clip-features'
import { processSocialDelivery, queueSocialFeature } from '@/lib/content/social-delivery'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET() {
  if (!await isContentAdmin()) return NextResponse.json({error:'Unauthorized'},{status:401})
  const {data,error}=await createAdminClient().from('content_items').select('*').not('site_category','is',null).order('created_at',{ascending:false}).limit(100)
  return error ? NextResponse.json({error:'Website content unavailable'},{status:503}) : NextResponse.json({items:data},{headers:{'Cache-Control':'private, no-store'}})
}
export async function POST(req:NextRequest) {
  if (!await isContentAdmin()) return NextResponse.json({error:'Unauthorized'},{status:401})
  if(req.headers.get('origin')!==req.nextUrl.origin) return NextResponse.json({error:'Invalid origin'},{status:403})
  try {
    const body=await req.json()
    if(body.action==='plan') return NextResponse.json({planned:await planSiteContent()})
    if(body.action==='prepare_clips') return NextResponse.json({planned:await planApprovedClipFeatures()})
    if(body.action==='publish_due') return NextResponse.json({published:await publishDueSiteContent()})
    if(!/^[0-9a-f-]{36}$/i.test(body.id || '') || !['save','approve','return'].includes(body.action) || typeof body.copy!=='string' || !body.copy.trim() || body.copy.length>15000) return NextResponse.json({error:'Invalid content update'},{status:400})
    if(body.action==='approve' && body.confirmAccuracy!==true) return NextResponse.json({error:'Confirm accuracy before approval'},{status:400})
    const db=createAdminClient()
    const found=await db.from('content_items').select('*').eq('id',body.id).not('site_category','is',null).single()
    if(found.error) throw found.error
    const delivery=await db.from('cs_social_deliveries').select('state').eq('content_item_id',body.id).in('state',['queued','submitting','scheduled','submission_unknown']).maybeSingle()
    if(delivery.error)throw delivery.error
    if(delivery.data)return NextResponse.json({error:'This item has an active social delivery. Review its Metricool receipt before changing the approved copy or schedule.'},{status:409})
    if(['published','archived','failed'].includes(found.data.status)) return NextResponse.json({error:'Already published; this draft cannot be edited here.'},{status:409})
    if(found.data.media_url && !await siteMediaApproved(found.data)) return NextResponse.json({error:'Clip QA or its canonical room approval is no longer valid. Review references before publication.'},{status:409})
    if(found.data.updated_at!==body.expectedUpdatedAt) return NextResponse.json({error:'Content changed; reopen it before saving.'},{status:409})
    const scheduled=body.scheduledAt ? new Date(body.scheduledAt) : new Date()
    if(!Number.isFinite(scheduled.getTime())) return NextResponse.json({error:'Invalid schedule'},{status:400})
    if(body.publishSocial===true && (body.action!=='approve' || !found.data.media_url || Array.from(body.copy.trim()).length>500 || scheduled.getTime()<Date.now()+1800000))return NextResponse.json({error:'Social delivery needs an approved clip, caption of at most 500 characters, and a release time at least 30 minutes ahead.'},{status:400})
    const {data:{user}}=await createClient().auth.getUser()
    const approved=body.action==='approve'
    const result=await db.from('content_items').update({copy_draft:body.copy.trim(),copy_final:approved?body.copy.trim():null,status:approved?'approved':'pending_approval',approved_at:approved?new Date().toISOString():null,approved_by:approved?user!.id:null,scheduled_at:scheduled.toISOString(),updated_at:new Date().toISOString()}).eq('id',body.id).eq('updated_at',body.expectedUpdatedAt).select('id').maybeSingle()
    if(result.error) throw result.error
    if(!result.data) return NextResponse.json({error:'Content changed; refresh.'},{status:409})
    let socialQueued=false,socialWarning:string|undefined,socialDeliveryStatus:string|undefined
    if(approved && body.publishSocial===true) {
      try {const fresh=await db.from('content_items').select('*').eq('id',body.id).single();if(fresh.error)throw fresh.error;await queueSocialFeature(fresh.data,user!.id);socialQueued=true}
      catch {socialWarning='Website approval saved, but social delivery was not queued. Refresh status before trying again.'}
      if(socialQueued)try{socialDeliveryStatus=(await processSocialDelivery()).status}catch{socialWarning='Social approval saved. Connection check failed; inspect the delivery status before retrying.'}
    }
    const published=approved?await publishDueSiteContent():0
    return NextResponse.json({saved:true,published,socialQueued,socialWarning,socialDeliveryStatus})
  }catch{return NextResponse.json({error:'Website content action failed; refresh its status before retrying.'},{status:503})}
}
