import { timingSafeEqual } from 'node:crypto'
import { galleryEnvironment, galleryProductionSettlementWorkerCredentialConfigured } from '@/lib/gallery/environment'
import { runGallerySettlementQueueOnce } from '@/lib/gallery/persist-test-settlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = {'Cache-Control':'private, no-store'}
const deny = (status:number) => Response.json({error:'Gallery settlement worker unavailable'},{status,headers})

/** Draft production-only manual worker. No schedule or shared worker integration.
 * A single authorized lease; no caller-selected order, money movement or notices.
 * Independent of the new-sales kill switch so existing buyers can be reconciled.
 */
export async function POST(req:Request) {
  if(process.env.VERCEL_ENV !== 'production' ||
     process.env.GALLERY_PRODUCTION_SETTLEMENT_WORKER !== 'true' ||
     process.env.GALLERY_SETTLEMENT_QUEUE_ENABLED !== 'true' ||
     process.env.GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS !== 'true' ||
     process.env.GALLERY_ISOLATED_TEST === 'true' ||
     process.env.GALLERY_SETTLEMENT_QA_ENDPOINT === 'true' ||
     !process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ||
     !/^acct_[A-Za-z0-9]+$/.test(process.env.GALLERY_STRIPE_PLATFORM_ACCOUNT_ID ?? '') ||
     process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'') !== 'https://nwfxvhqbjtfvoopcadff.supabase.co') return deny(404)
  try {
    const url=new URL(req.url)
    if(url.origin!=='https://www.cafe-sativa.com' ||
       url.pathname!=='/api/gallery/settlement-worker' ||
       url.search || url.hash || galleryEnvironment(req.url)!=='production') return deny(404)
    if(!galleryProductionSettlementWorkerCredentialConfigured()) return deny(404)
    const secret=process.env.GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET!
    const expected=Buffer.from('Bearer '+secret)
    const actual=Buffer.from(req.headers.get('authorization') ?? '')
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return deny(401)
    if(req.body!==null) return deny(400)
    const result=await runGallerySettlementQueueOnce(req.url)
    return Response.json({status:result.status},{headers})
  } catch {
    return deny(503)
  }
}
