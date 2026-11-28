import {createClient} from '@/lib/supabase/server'
import {createAdminClient} from '@/lib/supabase/admin'
import {galleryFinancialReviewMode} from '@/lib/gallery/environment'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const headers = {'Cache-Control':'private, no-store'}
const deny = (status:number) => Response.json({error:'Gallery financial review unavailable'},{status,headers})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const financialFields = 'order_id,artist_id,product_id,title_snapshot,currency,paid_at,fulfillment_state,quantity,line_total_cents,sale_kind,recorded_commission_cents,observed_at,provider_livemode,evidence_state,financial_evidence'
const refundFields = 'order_id,product_id,artist_id,product_kind,quantity,currency,total_cents,succeeded_refund_cents,stock_count,review_state,review_reason,provider_livemode'

/** Explicitly enabled, mode-scoped read-only review. Never infer staff status from user metadata,
 * a request parameter, email domain, or an artist's payment readiness. */
export async function GET(req:Request) {
  const mode=galleryFinancialReviewMode(req.url)
  if(mode==='blocked') return deny(404)
  const live=mode==='production'
  const params = new URL(req.url).searchParams
  const scope = params.get('scope') ?? 'artist'
  if(!['artist','owner'].includes(scope) || [...params.keys()].some(k=>k!=='scope') ||
     params.getAll('scope').length>1) return deny(400)
  try {
    const session = createClient()
    const {data:{user},error:authError} = await session.auth.getUser()
    if(authError || !user || !uuid.test(user.id)) return deny(401)
    const admin = createAdminClient()
    let artistId:string|undefined
    if(scope==='owner'){
      const ids = ((live?process.env.GALLERY_PRODUCTION_FINANCIAL_OWNER_IDS:process.env.GALLERY_TEST_FINANCIAL_OWNER_IDS) ?? '').split(',').map(x=>x.trim())
      if(!ids.every(x=>uuid.test(x)) || !ids.includes(user.id)) return deny(403)
    }else{
      const {data:artist,error} = await admin.from('artists').select('id,user_id').eq('user_id',user.id).maybeSingle()
      if(error || !artist || artist.user_id!==user.id || !uuid.test(artist.id))return deny(403)
      artistId=artist.id
    }
    // No raw snapshots, buyer identity or private object paths. Mode is derived
    // from trusted server configuration, not from a caller parameter.
    let query = admin.from('gallery_order_accepted_financial_review').select(financialFields)
      .eq('provider_livemode',live)
    if(artistId)query=query.eq('artist_id',artistId).eq('sale_kind','consigned')
    const {data:rows,error} = await query.order('paid_at',{ascending:false}).order('order_id').limit(101)
    if(error || !rows || rows.some(r=>r.provider_livemode!==live)) return deny(503)
    // Only mode-qualified private artwork refunds. No restock mutation exposed.
    let refunds:unknown[]=[]
    let moreRefunds=false
    if(scope==='owner'){
      const {data:queue,error:queueError}=await admin.from('gallery_refund_mode_review_candidates')
        .select(refundFields).eq('provider_livemode',live).order('order_id').limit(101)
      if(queueError || !queue || queue.some(r=>r.provider_livemode!==live))return deny(503)
      moreRefunds=queue.length>100
      refunds=queue.slice(0,100)
    }
    return Response.json({scope,mode,orders:rows.slice(0,100),
      more_orders:rows.length>100,refund_review:refunds,more_refunds:moreRefunds},{headers})
  } catch {
    return deny(503)
  }
}
