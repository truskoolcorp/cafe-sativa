import Stripe from 'stripe'
import { timingSafeEqual } from 'node:crypto'
import { sendGalleryDeliveryNotices } from '@/lib/gallery/send-delivery-notices'
import { reconcileGalleryInventory } from '@/lib/gallery/reconcile-inventory'
import { galleryEnvironment, galleryFulfillmentWorkerCredentialConfigured } from '@/lib/gallery/environment'
import { verifiedGalleryHouseAccount } from '@/lib/gallery/house-checkout'
import { authorizeStagedDigitalOrders } from '@/lib/gallery/fulfill-digital'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = {'Cache-Control':'private, no-store'}
const deny = (status:number) => Response.json({error:'Gallery fulfillment worker unavailable'},{status,headers})

/** Dedicated Gallery fulfillment/inventory worker. No shared cron credential,
 * caller-selected jobs, or automatic schedule. Existing paid buyers can be
 * fulfilled when the new-sales switch is off. */
export async function POST(req:Request) {
  try {
    const mode = galleryEnvironment(req.url)
    if(mode==='blocked' || process.env.GALLERY_DIGITAL_WORKER!=='true' ||
       process.env.GALLERY_PRIVATE_DOWNLOADS!=='true' || process.env.GALLERY_INVENTORY_HOLDS!=='true' ||
       !galleryFulfillmentWorkerCredentialConfigured(mode)) return deny(404)
    const live = mode==='production'
    const url = new URL(req.url)
    if(url.pathname!=='/api/gallery/worker' || url.search || url.hash) return deny(404)
    const platform = live ? process.env.GALLERY_STRIPE_PLATFORM_ACCOUNT_ID : process.env.GALLERY_TEST_STRIPE_PLATFORM_ACCOUNT_ID
    if(!platform || !/^acct_[A-Za-z0-9]+$/.test(platform)) return deny(404)
    if(live) {
      if(url.origin!=='https://www.cafe-sativa.com' ||
         process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/,'')!==url.origin ||
         process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!=='https://nwfxvhqbjtfvoopcadff.supabase.co' ||
         process.env.GALLERY_ISOLATED_TEST==='true' || process.env.GALLERY_SETTLEMENT_QA_ENDPOINT==='true' ||
         !process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ||
         platform!==process.env.GALLERY_HOUSE_STRIPE_ACCOUNT_ID) return deny(404)
    } else {
      // Only a disposable local acceptance runner may use the test path.
      const db = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
      if(process.env.VERCEL_ENV || process.env.VERCEL || process.env.VERCEL_URL || process.env.VERCEL_DEPLOYMENT_ID ||
         url.protocol!=='http:' || url.hostname!=='127.0.0.1' || !url.port ||
         db.protocol!=='http:' || db.hostname!=='127.0.0.1' || !db.port ||
         db.origin===url.origin || process.env.GALLERY_DELIVERY_NOTICES==='true') return deny(404)
    }
    const secret = live ? process.env.GALLERY_PRODUCTION_FULFILLMENT_WORKER_SECRET! : process.env.GALLERY_TEST_FULFILLMENT_WORKER_SECRET!
    const expected=Buffer.from('Bearer '+secret)
    const actual=Buffer.from(req.headers.get('authorization') ?? '')
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return deny(401)
    if(req.body!==null) return deny(400)
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!,{timeout:3000,maxNetworkRetries:0})
    if(!await verifiedGalleryHouseAccount(stripe,platform,false)) return deny(503)
    const fulfillment=await authorizeStagedDigitalOrders()
    const notifications=live ? await sendGalleryDeliveryNotices() : {enabled:false,sent:0,attention:0}
    const inventory=await reconcileGalleryInventory()
    return Response.json({fulfillment,notifications,inventory},{headers})
  } catch {
    return deny(503)
  }
}
