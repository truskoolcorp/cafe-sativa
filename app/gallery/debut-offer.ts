import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { galleryDebutOffer } from '@/lib/gallery/house-checkout'
import { galleryEnvironment, gallerySalesEnabled } from '@/lib/gallery/environment'
import { debutWork } from './debut-work'

type CatalogOffer = { id: string; artist_id: string; slug: string; kind: string; price_cents: number; currency: string; stock_count: number }
type AvailableDebut = Omit<typeof debutWork, 'id'> & { id: string; price_cents: number; currency: 'usd'; stock_count: number }

/** The view supplies only the commercial tuple. Editorial identity and artwork remain canonical.
 * Ambiguous, malformed, missing, sold-out, or unapproved rows never become public offers. */
export function approvedDebutDisplay(row: unknown, env = process.env): typeof debutWork | AvailableDebut {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return debutWork
  const candidate = row as CatalogOffer
  if (!galleryDebutOffer(candidate, env) || !Number.isSafeInteger(candidate.stock_count) || candidate.stock_count < 1) return debutWork
  return { ...debutWork, id: candidate.id, price_cents: 1200, currency: 'usd', stock_count: candidate.stock_count }
}

async function readPublishedDebut() {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value, set: () => {}, remove: () => {} } },
  )
  // A dedicated exact-slug read avoids ambiguity hidden by the grid's 60-row limit.
  return supabase.from('gallery_v').select('id,artist_id,slug,kind,price_cents,currency,stock_count').eq('slug', debutWork.slug).maybeSingle()
}

/** Server-only availability hint. Checkout independently revalidates the private asset,
 * publication, account, reservation and settlement prerequisites. No provider write here. */
export async function loadDebutDisplay(
  read: () => PromiseLike<{ data: unknown; error?: unknown }> = readPublishedDebut,
  env = process.env,
): Promise<typeof debutWork | AvailableDebut> {
  const mode = galleryEnvironment(env.NEXT_PUBLIC_SITE_URL || 'https://www.cafe-sativa.com', env)
  if (!gallerySalesEnabled(mode, env) || env.GALLERY_HOUSE_CHECKOUT_ENABLED !== 'true') return debutWork
  try {
    const {data, error} = await read()
    return error ? debutWork : approvedDebutDisplay(data, env)
  } catch { return debutWork }
}
