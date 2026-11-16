import { createClient } from '@supabase/supabase-js'

export function createAdminClient(fetcher: typeof fetch = fetch) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceRoleKey, {
    // Admin reads and short-lived Storage signatures must never enter Next's
    // persistent fetch cache. A cached signed URL can outlive its JWT expiry.
    global: { fetch: (input, init) => fetcher(input, { ...init, cache: 'no-store' }) },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
