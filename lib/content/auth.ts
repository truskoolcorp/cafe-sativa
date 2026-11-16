import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'

export function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(header)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function isContentAdmin() {
  try {
    const client = createClient()
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return false
    // app_metadata is server-controlled; user_metadata must never grant admin access.
    return user.app_metadata?.cafe_sativa_admin === true
  } catch { return false }
}
