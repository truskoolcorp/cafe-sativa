import { timingSafeEqual } from 'node:crypto'
import { galleryEnvironment } from '@/lib/gallery/environment'
import { runGallerySettlementQueueOnce } from '@/lib/gallery/persist-test-settlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = {'Cache-Control':'private, no-store'}
const deny = (status:number) => Response.json({error:'Gallery settlement QA unavailable'},{status,headers})

/** Manual one-lease entry point for the disposable local provider acceptance run.
 * No GET, scheduler, production path, shared cron secret or caller-selected order.
 * Never performs a payment, refund, notice or automatic restock.
 */
export async function POST(req:Request) {
  if(process.env.GALLERY_SETTLEMENT_QA_ENDPOINT !== 'true' ||
     process.env.GALLERY_SETTLEMENT_QUEUE_ENABLED !== 'true' ||
     process.env.GALLERY_SETTLEMENT_OBSERVATIONS !== 'true' ||
     process.env.GALLERY_DELIVERY_NOTICES === 'true' ||
     process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL ||
     process.env.VERCEL_DEPLOYMENT_ID) return deny(404)
  try {
    const reqUrl = new URL(req.url)
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '')
    const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    const loopback = (u:URL) => u.protocol==='http:' && u.hostname==='127.0.0.1' &&
      !!u.port && u.pathname==='/' && !u.username && !u.password && !u.search && !u.hash
    if(!loopback(site) || !loopback(database) || site.origin===database.origin ||
       reqUrl.origin!==site.origin || reqUrl.pathname!=='/api/gallery/settlement-qa' ||
       reqUrl.search || reqUrl.hash || galleryEnvironment(req.url)!=='isolated-test') return deny(404)
    const secret = process.env.GALLERY_SETTLEMENT_QA_SECRET
    if(!secret || !/^[A-Za-z0-9_-]{32,128}$/.test(secret) ||
       [process.env.CRON_SECRET,process.env.GALLERY_TEST_STRIPE_WEBHOOK_SECRET,
        process.env.STRIPE_WEBHOOK_SECRET,process.env.STRIPE_SECRET_KEY,
        process.env.SUPABASE_SERVICE_ROLE_KEY].includes(secret)) return deny(404)
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
