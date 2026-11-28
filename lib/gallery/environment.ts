// Server-side only: preview deployments inherit project-wide credentials.
// A non-production Gallery route is never allowed to assume that inheritance is safe.
// The existing replica is not a disposable Gallery sandbox either.
const EXCLUDED_TEST_DATABASE_HOSTS = new Set([
  'nwfxvhqbjtfvoopcadff.supabase.co',
  'anrprovgdpwqcalkolsz.supabase.co',
])

type Env = Record<string, string | undefined>

export type GalleryEnvironment = 'production' | 'isolated-test' | 'blocked'

// Temporary Stripe CLI credentials are supported only on an explicit non-Vercel,
// literal-loopback test harness. Hosted preview cannot use these credentials.
function acceptsEphemeralStripe(env: Env): boolean {
  if (env.GALLERY_LOCAL_STRIPE_CLI !== 'true' || env.VERCEL_ENV || env.VERCEL ||
      env.VERCEL_URL || env.VERCEL_DEPLOYMENT_ID || env.GALLERY_ISOLATED_TEST !== 'true' ||
      env.GALLERY_DELIVERY_NOTICES === 'true' ||
      !/^rkcs_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY ?? '') ||
      !/^acct_[A-Za-z0-9]+$/.test(env.GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID ?? '') ||
      env.GALLERY_EPHEMERAL_STRIPE_ACCOUNT_ID !== env.GALLERY_HOUSE_STRIPE_ACCOUNT_ID) return false
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL ?? '')
    const database = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    const literalLoopback = (u: URL) => u.protocol === 'http:' && u.hostname === '127.0.0.1' &&
      !!u.port && u.pathname === '/' && !u.username && !u.password && !u.search && !u.hash
    return literalLoopback(site) && literalLoopback(database) && site.origin !== database.origin &&
      database.href === new URL(env.GALLERY_TEST_SUPABASE_URL ?? '').href
  } catch { return false }
}

export function galleryEnvironment(requestUrl: string, env: Env = process.env): GalleryEnvironment {
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.GALLERY_ISOLATED_TEST !== 'true' ||
      (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') && !acceptsEphemeralStripe(env)) ||
      !env.GALLERY_TEST_STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') ||
      env.GALLERY_TEST_STRIPE_WEBHOOK_SECRET === env.STRIPE_WEBHOOK_SECRET ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      env.GALLERY_INVENTORY_HOLDS !== 'true' ||
      env.GALLERY_PRIVATE_DOWNLOADS !== 'true' ||
      env.GALLERY_DELIVERY_NOTICES === 'true' ||
      !env.NEXT_PUBLIC_SUPABASE_URL || !env.GALLERY_TEST_SUPABASE_URL || !env.NEXT_PUBLIC_SITE_URL) return 'blocked'
  try {
    const database = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
    const expected = new URL(env.GALLERY_TEST_SUPABASE_URL)
    const site = new URL(env.NEXT_PUBLIC_SITE_URL)
    const request = new URL(requestUrl)
    const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
    const hosted = database.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(database.hostname)
    const local = env.VERCEL_ENV !== 'preview' && loopback(database.hostname) && loopback(site.hostname)
    if (!(hosted || local) || database.href !== expected.href ||
        EXCLUDED_TEST_DATABASE_HOSTS.has(database.hostname) || site.origin !== request.origin ||
        (!local && site.protocol !== 'https:') || database.username || database.password ||
        database.search || database.hash || database.pathname !== '/') return 'blocked'
    return 'isolated-test'
  } catch {
    return 'blocked'
  }
}

/** Keep settlement admission separate from new-sales availability. */
export function galleryProductionSettlementConfigured(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'production' &&
    env.GALLERY_PRODUCTION_SETTLEMENT_WEBHOOK === 'true' &&
    env.GALLERY_SETTLEMENT_QUEUE_ENABLED === 'true' &&
    env.GALLERY_PRODUCTION_SETTLEMENT_OBSERVATIONS === 'true' &&
    env.GALLERY_REFUND_LEDGER === 'true' &&
    env.GALLERY_ISOLATED_TEST !== 'true' && env.GALLERY_SETTLEMENT_QA_ENDPOINT !== 'true' &&
    env.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true &&
    /^acct_[A-Za-z0-9]+$/.test(env.GALLERY_STRIPE_PLATFORM_ACCOUNT_ID ?? '') &&
    env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/,'') === 'https://www.cafe-sativa.com' &&
    env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'') === 'https://nwfxvhqbjtfvoopcadff.supabase.co'
}

/** Owner authority is explicit and server-side; no user metadata or email-domain inference. */
export function galleryProductionFinancialReviewConfigured(env: Env = process.env): boolean {
  const owners = (env.GALLERY_PRODUCTION_FINANCIAL_OWNER_IDS ?? '').split(',').map(x=>x.trim())
  return galleryProductionSettlementConfigured(env) &&
    env.GALLERY_PRODUCTION_FINANCIAL_REVIEW === 'true' &&
    owners.every(x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))
}

export function galleryFinancialReviewMode(requestUrl:string,env:Env=process.env):GalleryEnvironment {
  const mode=galleryEnvironment(requestUrl,env)
  if(mode==='isolated-test' && env.GALLERY_FINANCIAL_REVIEW_TEST==='true') return mode
  if(mode==='production' && galleryProductionFinancialReviewConfigured(env)) {
    try { if(new URL(requestUrl).origin==='https://www.cafe-sativa.com') return mode } catch {}
  }
  return 'blocked'
}

/** Same credential admission for the worker and public new-sales interlock. */
export function galleryProductionSettlementWorkerCredentialConfigured(env: Env = process.env): boolean {
  const secret = env.GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET
  return !!secret && /^[A-Za-z0-9_-]{32,128}$/.test(secret) &&
    ![env.CRON_SECRET,env.GALLERY_PRODUCTION_FULFILLMENT_WORKER_SECRET,env.GALLERY_TEST_FULFILLMENT_WORKER_SECRET,env.GALLERY_SETTLEMENT_QA_SECRET,env.GALLERY_TEST_STRIPE_WEBHOOK_SECRET,
      env.STRIPE_WEBHOOK_SECRET,env.STRIPE_SECRET_KEY,env.SUPABASE_SERVICE_ROLE_KEY,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY].includes(secret)
}

/** Delivery/inventory authority is separate from settlement-only authority. */
export function galleryFulfillmentWorkerCredentialConfigured(mode: GalleryEnvironment, env: Env = process.env): boolean {
  if (mode === 'blocked') return false
  const live = mode === 'production'
  const secret = live ? env.GALLERY_PRODUCTION_FULFILLMENT_WORKER_SECRET : env.GALLERY_TEST_FULFILLMENT_WORKER_SECRET
  return !!secret && /^[A-Za-z0-9_-]{32,128}$/.test(secret) &&
    ![env.CRON_SECRET,env.GALLERY_PRODUCTION_SETTLEMENT_WORKER_SECRET,env.GALLERY_SETTLEMENT_QA_SECRET,
      live ? env.GALLERY_TEST_FULFILLMENT_WORKER_SECRET : env.GALLERY_PRODUCTION_FULFILLMENT_WORKER_SECRET,
      env.GALLERY_TEST_STRIPE_WEBHOOK_SECRET,env.STRIPE_WEBHOOK_SECRET,env.STRIPE_SECRET_KEY,
      env.SUPABASE_SERVICE_ROLE_KEY,env.NEXT_PUBLIC_SUPABASE_ANON_KEY].includes(secret)
}

/** New checkout only. Never use this switch to gate paid/refunded events,
 * fulfillment or access for existing buyers. Defaults closed in every environment. */
export function gallerySalesEnabled(mode: GalleryEnvironment, env: Env = process.env): boolean {
  if (mode === 'blocked' || env.GALLERY_SALES_ENABLED !== 'true' ||
      env.GALLERY_INVENTORY_HOLDS !== 'true' || env.GALLERY_PRIVATE_DOWNLOADS !== 'true' ||
      env.GALLERY_DIGITAL_WORKER !== 'true') return false
  return mode === 'production' ? galleryProductionFinancialReviewConfigured(env) &&
    env.GALLERY_PRODUCTION_SETTLEMENT_WORKER === 'true' &&
    galleryProductionSettlementWorkerCredentialConfigured(env) && galleryFulfillmentWorkerCredentialConfigured(mode,env) &&
    env.GALLERY_STRIPE_PLATFORM_ACCOUNT_ID === env.GALLERY_HOUSE_STRIPE_ACCOUNT_ID :
    env.STRIPE_SECRET_KEY?.startsWith('sk_test_') === true || acceptsEphemeralStripe(env)
}
