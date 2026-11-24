// Server-side only: preview deployments inherit project-wide credentials.
// A non-production Gallery route is never allowed to assume that inheritance is safe.
const PRODUCTION_DATABASE_HOST = 'nwfxvhqbjtfvoopcadff.supabase.co'

type Env = Record<string, string | undefined>

export type GalleryEnvironment = 'production' | 'isolated-test' | 'blocked'

export function galleryEnvironment(requestUrl: string, env: Env = process.env): GalleryEnvironment {
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.GALLERY_ISOLATED_TEST !== 'true' ||
      !env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ||
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
