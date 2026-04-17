import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // Prevent crash in production UI
    console.warn('Supabase env vars missing')
    return null as any
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
