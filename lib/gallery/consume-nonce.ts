import { createAdminClient } from '@/lib/supabase/admin'

// Database uniqueness, not an in-memory check, prevents concurrent replay.
// Requires the reviewed nonce migration. Missing table or any error denies access.
export async function consumeGalleryNonce(nonce: string, expiresAt: number): Promise<boolean> {
  try {
    if (!/^[0-9a-f]{64}$/.test(nonce) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false
    const admin = createAdminClient()
    const { error } = await admin.from('gallery_consumed_wallet_nonces').insert({
      nonce, expires_at: new Date(expiresAt).toISOString()
    })
    return !error
  } catch { return false }
}
