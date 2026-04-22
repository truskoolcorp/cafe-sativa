import type { Metadata } from 'next'
import Link from 'next/link'
import { Palette, Package } from 'lucide-react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Badge } from '@/components/ui/badge'

/**
 * /gallery
 *
 * Server component. Lists every published product from every approved
 * artist. SSRs the full HTML so the gallery grid is in the initial
 * page load (good for SEO + share previews).
 *
 * Empty state matters here: for the first week or two post-launch
 * there will be zero products. The empty state leans into "coming
 * soon" energy with the artist CTA, rather than showing a sad empty
 * box.
 *
 * Data source: gallery_v, the denormalized view that joins products
 * with their artist and only returns status='published' on approved
 * artists. RLS policy products_read_published enforces the same
 * invariant at the row level.
 */

export const metadata: Metadata = {
  title: 'The Gallery — Café Sativa',
  description:
    'Original work from our resident artists. Shoppable art across physical editions, digital pieces, and NFTs — with a cut going directly to each artist.',
}

export const dynamic = 'force-dynamic'

type GalleryRow = {
  id: string
  slug: string
  title: string
  description: string | null
  kind: 'physical' | 'digital' | 'nft'
  price_cents: number
  currency: string
  primary_image_url: string | null
  stock_count: number | null
  created_at: string
  artist_id: string
  artist_slug: string
  artist_name: string
  artist_avatar: string | null
}

async function loadGallery(): Promise<GalleryRow[]> {
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

  // gallery_v uses security_invoker, so reads from it obey whatever
  // RLS applies to the underlying tables. Fine — we already scoped
  // it to published+approved in the view definition.
  const { data, error } = await supabase
    .from('gallery_v')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) {
    console.error('[/gallery] load failed', error)
    return []
  }

  return (data as GalleryRow[]) || []
}

export default async function GalleryPage() {
  const products = await loadGallery()

  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      {/* Header band */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-3 py-1 mb-4">
              <Palette className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                The Gallery
              </span>
            </div>
            <h1 className="font-heading text-5xl md:text-6xl font-bold text-foreground leading-[1.05]">
              Work from our{' '}
              <span className="text-primary italic">resident artists.</span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground font-body max-w-2xl mt-4 leading-relaxed">
              Original pieces, editions, digital work, and NFTs across the
              Dallas–Tenerife axis. Every purchase sends funds directly to the
              artist. We keep 10% to run the place.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/artist-dashboard"
              className="text-sm font-body text-muted-foreground hover:text-primary transition-colors"
            >
              Sell your work →
            </Link>
          </div>
        </div>

        {/* Grid */}
        {products.length === 0 ? (
          <EmptyGallery />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {products.map((p) => (
              <GalleryCard key={p.id} row={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GalleryCard({ row }: { row: GalleryRow }) {
  const priceUsd = (row.price_cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: (row.currency || 'usd').toUpperCase(),
  })
  const kindLabel = row.kind === 'nft' ? 'NFT' : row.kind

  const soldOut = row.stock_count !== null && row.stock_count <= 0

  return (
    <Link
      href={`/gallery/${row.slug}`}
      className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors"
    >
      {/* Image */}
      <div className="relative aspect-[4/5] bg-muted overflow-hidden">
        {row.primary_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.primary_image_url}
            alt={row.title}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {soldOut && (
          <div className="absolute inset-0 bg-background/75 flex items-center justify-center">
            <Badge variant="destructive" className="font-body">
              Sold out
            </Badge>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-heading text-lg font-bold text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors">
            {row.title}
          </h3>
        </div>

        <p className="text-sm text-muted-foreground font-body mb-3 line-clamp-1">
          by {row.artist_name}
        </p>

        <div className="flex items-baseline justify-between">
          <span className="font-heading text-xl text-primary font-bold">
            {priceUsd}
          </span>
          <span className="text-[10px] tracking-widest uppercase text-muted-foreground font-body font-semibold">
            {kindLabel}
          </span>
        </div>
      </div>
    </Link>
  )
}

function EmptyGallery() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/30 p-12 md:p-16 text-center">
      <Palette className="w-10 h-10 text-primary/60 mx-auto mb-4" />
      <h2 className="font-heading text-3xl font-bold text-foreground mb-3">
        Opening soon.
      </h2>
      <p className="text-base text-muted-foreground font-body max-w-md mx-auto mb-6 leading-relaxed">
        Our first batch of artists is being onboarded now. Check back in a few
        days, or — if you make things — list your own work.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href="/artist-dashboard"
          className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-6 py-3 text-sm font-body font-semibold hover:bg-primary/90 transition-colors"
        >
          Sell your work
        </Link>
        <Link
          href="/events"
          className="inline-flex items-center justify-center rounded-lg border border-border px-6 py-3 text-sm font-body font-semibold text-foreground hover:border-primary/40 transition-colors"
        >
          Browse events instead
        </Link>
      </div>
    </div>
  )
}
