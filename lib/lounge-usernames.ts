import type { SupabaseClient } from '@supabase/supabase-js'

export const loungeUsernamesEnabled = process.env.NEXT_PUBLIC_LOUNGE_USERNAMES_ENABLED === 'true'

export function normalizeLoungeUsername(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized.length >= 3 && normalized.length <= 24 && /^[a-z][a-z0-9]*([-_][a-z0-9]+)*$/.test(normalized)
    ? normalized : null
}

export async function readLoungeUsername(client: SupabaseClient, userId: string) {
  if (!loungeUsernamesEnabled) return null
  const { data } = await client.from('lounge_usernames')
    .select('generated_username,custom_username').eq('user_id', userId).maybeSingle()
  return (data?.custom_username || data?.generated_username || null) as string | null
}
