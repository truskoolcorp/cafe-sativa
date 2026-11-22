import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { CLEAN_REHEARSAL_OBJECT } from './ahnika-premiere-media'

export async function signCleanRehearsalCut() {
  try {
    const storage = createAdminClient().storage
    const { data: bucket } = await storage.getBucket('cafe-sativa-content')
    if (!bucket || bucket.public !== false) return null
    const { data } = await storage.from(bucket.id).createSignedUrl(CLEAN_REHEARSAL_OBJECT, 60)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}
