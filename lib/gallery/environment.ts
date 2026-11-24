// Server-side only: preview deployments inherit project-wide credentials.
// A non-production Gallery route is never allowed to assume that inheritance is safe.
const PRODUCTION_DATABASE_HOST = 'nwfxvhqbjtfvoopcadff.supabase.co'

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

// A distinct merchant-owned sandbox is never eligible for hosted or live use.
const MERCHANT_STRIPE_ACCOUNT = 'acct_1GZMxgIDc7LlvDW9'
const LOCAL_APPLICATION_ORIGIN = 'http://127.0.0.1:4116'
const LOCAL_DATABASE_ORIGIN = 'http://127.0.0.1:54321'
const fixtureUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

export function usesMerchantSandboxKey(key: string | undefined): boolean {
  return key?.startsWith('rk_test_') === true
}
function acceptsMerchantSandbox(env: Env): boolean {
  const account = env.GALLERY_MERCHANT_SANDBOX_ACCOUNT_ID
  if (!account || !/^acct_[A-Za-z0-9]+$/.test(account) || account === MERCHANT_STRIPE_ACCOUNT ||
      account !== env.GALLERY_HOUSE_STRIPE_ACCOUNT_ID ||
      !/^rk_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY ?? '') ||
      env.GALLERY_LOCAL_STRIPE_MERCHANT_SANDBOX !== 'true' || env.GALLERY_LOCAL_STRIPE_CLI === 'true' ||
      env.GALLERY_PRIVATE_TEST_FIXTURES !== 'true' || env.GALLERY_ISOLATED_TEST !== 'true' ||
      env.GALLERY_PRIVATE_DOWNLOADS !== 'true' || env.GALLERY_INVENTORY_HOLDS !== 'true' ||
      env.GALLERY_DELIVERY_NOTICES !== 'false' ||
      env.VERCEL_ENV || env.VERCEL || env.VERCEL_URL || env.VERCEL_DEPLOYMENT_ID ||
      !fixtureUuid.test(env.GALLERY_HOUSE_PRODUCT_ID ?? '') ||
      !fixtureUuid.test(env.GALLERY_HOUSE_ARTIST_ID ?? '') ||
      env.GALLERY_HOUSE_PRODUCT_ID === env.GALLERY_HOUSE_ARTIST_ID) return false
  return env.NEXT_PUBLIC_SITE_URL === LOCAL_APPLICATION_ORIGIN &&
    env.NEXT_PUBLIC_SUPABASE_URL === LOCAL_DATABASE_ORIGIN &&
    env.GALLERY_TEST_SUPABASE_URL === LOCAL_DATABASE_ORIGIN
}

// Next can synthesize localhost for the literal loopback host. Do not trust
// forwarded host headers or normalize any other port, host or scheme.
export function galleryMerchantRequestUrl(req: Pick<Request, 'url' | 'headers'>, env: Env = process.env): string {
  if (!acceptsMerchantSandbox(env)) return req.url
  try {
    const site = new URL(LOCAL_APPLICATION_ORIGIN)
    const url = new URL(req.url)
    if (url.origin === site.origin && req.headers.get('host') !== site.host) return 'http://127.0.0.1:1/'
    if (url.origin === 'http://localhost:4116' && !url.username && !url.password &&
        req.headers.get('host') === site.host) {
      url.hostname = site.hostname
      return url.toString()
    }
  } catch {}
  return req.url
}

export function galleryEnvironment(requestUrl: string, env: Env = process.env): GalleryEnvironment {
  if (env.VERCEL_ENV === 'production') return usesMerchantSandboxKey(env.STRIPE_SECRET_KEY) ? 'blocked' : 'production'
  if (env.GALLERY_ISOLATED_TEST !== 'true' ||
      (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') && !acceptsEphemeralStripe(env) && !acceptsMerchantSandbox(env)) ||
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
    if (usesMerchantSandboxKey(env.STRIPE_SECRET_KEY) && (request.username || request.password)) return 'blocked'
    const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
    const hosted = database.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(database.hostname)
    const local = env.VERCEL_ENV !== 'preview' && loopback(database.hostname) && loopback(site.hostname)
    if (!(hosted || local) || database.href !== expected.href ||
        database.hostname === PRODUCTION_DATABASE_HOST || site.origin !== request.origin ||
        (!local && site.protocol !== 'https:') || database.username || database.password ||
        database.search || database.hash || database.pathname !== '/') return 'blocked'
    return 'isolated-test'
  } catch {
    return 'blocked'
  }
}

/** New checkout only. Never use this switch to gate paid/refunded events,
 * fulfillment or access for existing buyers. Defaults closed in every environment. */
export function gallerySalesEnabled(mode: GalleryEnvironment, env: Env = process.env): boolean {
  if (mode === 'blocked' || env.GALLERY_SALES_ENABLED !== 'true' ||
      env.GALLERY_INVENTORY_HOLDS !== 'true' || env.GALLERY_PRIVATE_DOWNLOADS !== 'true' ||
      env.GALLERY_DIGITAL_WORKER !== 'true') return false
  return mode === 'production' ? env.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true :
    env.STRIPE_SECRET_KEY?.startsWith('sk_test_') === true || acceptsEphemeralStripe(env) || acceptsMerchantSandbox(env)
}
