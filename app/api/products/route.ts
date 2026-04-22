import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * POST /api/products
 *
 * Artist creates or updates a product. Body:
 *   {
 *     id?: string           // present = update, absent = create
 *     title: string
 *     description?: string
 *     kind: 'physical' | 'digital' | 'nft'
 *     price_cents: number
 *     primary_image_url?: string
 *     stock_count?: number | null
 *     weight_grams?: number   // physical only
 *     digital_delivery_url?: string  // digital only
 *     blockchain?: string     // nft only
 *     status: 'draft' | 'published' | 'archived'
 *   }
 *
 * Uses the authenticated SSR client so RLS enforces ownership — we
 * don't need to do a second lookup to verify "is this artist's
 * product". The policy does it.
 *
 * One thing we DO check manually: published products require an
 * approved artist. We verify before letting status flip to
 * 'published'.
 */

type ProductKind = 'physical' | 'digital' | 'nft'
type ProductStatus = 'draft' | 'published' | 'archived'

type Body = {
  id?: string
  title: string
  description?: string
  kind: ProductKind
  price_cents: number
  currency?: string
  primary_image_url?: string
  stock_count?: number | null
  weight_grams?: number
  digital_delivery_url?: string
  blockchain?: 'polygon' | 'ethereum' | 'base'
  status?: ProductStatus
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function POST(req: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  )

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  // Validate required fields
  if (!body.title?.trim()) {
    return NextResponse.json(
      { error: 'Title is required.' },
      { status: 400 }
    )
  }
  if (!['physical', 'digital', 'nft'].includes(body.kind)) {
    return NextResponse.json(
      { error: 'kind must be physical, digital, or nft.' },
      { status: 400 }
    )
  }
  if (typeof body.price_cents !== 'number' || body.price_cents < 0) {
    return NextResponse.json(
      { error: 'price_cents must be a non-negative number.' },
      { status: 400 }
    )
  }

  // Look up the artist row for this user
  const { data: artist } = await supabase
    .from('artists')
    .select('id, is_approved, onboarding_state')
    .eq('user_id', authData.user.id)
    .maybeSingle()

  if (!artist) {
    return NextResponse.json(
      {
        error: 'Complete artist onboarding first.',
        code: 'no_artist_profile',
      },
      { status: 403 }
    )
  }

  const status = body.status ?? 'draft'

  if (status === 'published' && !artist.is_approved) {
    return NextResponse.json(
      {
        error:
          'Finish Stripe onboarding before publishing. Save as draft for now.',
        code: 'not_approved',
      },
      { status: 403 }
    )
  }

  // Build the payload
  const payload: Record<string, any> = {
    artist_id: artist.id,
    title: body.title.trim(),
    description: body.description?.trim() || null,
    kind: body.kind,
    status,
    price_cents: Math.round(body.price_cents),
    currency: body.currency || 'usd',
    primary_image_url: body.primary_image_url?.trim() || null,
    stock_count: body.stock_count ?? null,
    weight_grams: body.kind === 'physical' ? body.weight_grams ?? null : null,
    digital_delivery_url:
      body.kind === 'digital' ? body.digital_delivery_url?.trim() || null : null,
    blockchain: body.kind === 'nft' ? body.blockchain ?? null : null,
    on_chain_status: body.kind === 'nft' ? 'not_minted' : null,
  }

  if (body.id) {
    // Update path. RLS will block this if the row isn't owned by the
    // artist — no extra check needed.
    const { data: updated, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', body.id)
      .select()
      .single()

    if (error) {
      console.error('[products] update failed', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ product: updated })
  }

  // Create path — need a slug. Derive from title, dedupe on collision.
  let slug = slugify(body.title)
  if (!slug) slug = 'product'

  // Look for same slug under this artist; if taken, append
  const { data: slugTaken } = await supabase
    .from('products')
    .select('id')
    .eq('artist_id', artist.id)
    .eq('slug', slug)
    .maybeSingle()
  if (slugTaken) {
    slug = `${slug}-${Date.now().toString(36).slice(-6)}`
  }

  const { data: created, error: createError } = await supabase
    .from('products')
    .insert({ ...payload, slug })
    .select()
    .single()

  if (createError) {
    console.error('[products] insert failed', createError)
    return NextResponse.json({ error: createError.message }, { status: 500 })
  }

  return NextResponse.json({ product: created })
}
