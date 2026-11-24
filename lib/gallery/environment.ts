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

/**
 * Next can synthesize localhost for a request received on a literal-loopback
 * hostname. Only the explicitly isolated anonymous-CLI harness can alias that
 * exact framework URL; require its original literal Host and matching HTTP port.
 */
export function galleryRequestUrl(req: Pick<Request, 'url' | 'headers'>, env: Env = process.env): string {
  if (!acceptsEphemeralStripe(env)) return req.url
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL!)
    const url = new URL(req.url)
    if (url.hostname === 'localhost' && url.protocol === 'http:' &&
        url.port === site.port && !url.username && !url.password &&
        req.headers.get('host') === site.host) {
      url.hostname = site.hostname
      return url.toString()
    }
  } catch {}
  return req.url
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
    env.STRIPE_SECRET_KEY?.startsWith('sk_test_') === true || acceptsEphemeralStripe(env)
}
