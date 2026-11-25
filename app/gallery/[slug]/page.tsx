import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Badge } from '@/components/ui/badge'
import { BuyButton } from './BuyButton'
import { galleryDebutOffer } from '@/lib/gallery/house-checkout'
import { galleryEnvironment, gallerySalesEnabled } from '@/lib/gallery/environment'
import { artworkCreationMethodEnabled, declaredAiArtworkLabel } from '@/lib/gallery/artwork-creation-method'

/** Published physical/digital artwork. New checkout is default-off and never available on unisolated previews. */

export const dynamic = 'force-dynamic'

type Params = { params: { slug: string } }

async function loadProduct(slug: string) {
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

  const { data, error } = await supabase
    .from('gallery_v')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    console.error('[/gallery/[slug]] load failed', error)
    return null
  }
  return data && ['digital','physical'].includes(data.kind) ? data : null
}

export async function generateMetadata({
  params,
}: Params): Promise<Metadata> {
  const product = await loadProduct(params.slug)
  if (!product) {
    return { title: 'Gallery — Café Sativa' }
  }
  return {
    title: `${product.title} by ${product.artist_name} — Café Sativa`,
    description:
      product.description?.slice(0, 160) ||
      `Original work by ${product.artist_name} in the Café Sativa Gallery.`,
    openGraph: {
      title: `${product.title} by ${product.artist_name}`,
      images: product.primary_image_url
        ? [{ url: product.primary_image_url }]
        : undefined,
    },
  }
}

export default async function ProductDetailPage({ params }: Params) {
  const product = await loadProduct(params.slug)

  if (!product) {
    notFound()
  }

  const priceDisplay = (product.price_cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: (product.currency || 'usd').toUpperCase(),
  })

  const mode = galleryEnvironment(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.cafe-sativa.com')
  const salesEnabled = gallerySalesEnabled(mode) && (mode !== 'production' || galleryDebutOffer(product))
  const methodLabel = artworkCreationMethodEnabled ? declaredAiArtworkLabel(product.declared_ai_creation_method) : null
  const soldOut = product.stock_count !== null && product.stock_count <= 0
  const kindLabel =
    product.kind === 'digital' ? 'Digital art' : 'Physical'

  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back link */}
        <Link
          href="/gallery"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground font-body mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          All work
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12">
          {/* Image */}
          <div className="lg:col-span-3">
            <div className="flex justify-center overflow-hidden rounded-xl border border-border bg-muted">
              {product.primary_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.primary_image_url}
                  alt={product.title}
                  className="block h-auto w-auto max-h-[min(78svh,850px)] max-w-full"
                />
              ) : (
                <div className="flex aspect-[4/5] w-full items-center justify-center text-muted-foreground">
                  No image
                </div>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="lg:col-span-2 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge
                  variant="outline"
                  className="text-[10px] tracking-widest uppercase"
                >
                  {kindLabel}
                </Badge>
                {soldOut && (
                  <Badge variant="destructive" className="text-[10px]">
                    Sold out
                  </Badge>
                )}
              </div>

              <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
                {product.title}
              </h1>

              <p className="text-lg text-muted-foreground font-body mt-3">
                by{' '}
                <span className="text-foreground font-semibold">
                  {product.artist_name}
                </span>
              </p>
            </div>

            {methodLabel && <p className="text-sm text-muted-foreground">Artist-declared creation method: {methodLabel}</p>}

            {/* Price card */}
            <div className="rounded-xl border border-primary/40 bg-card p-5">
              <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-1">
                Price
              </p>
              <p className="font-heading text-4xl font-bold text-primary">
                {priceDisplay}
              </p>

              {product.stock_count !== null &&
                product.stock_count !== undefined && (
                  <p className="text-xs text-muted-foreground font-body mt-2">
                    {product.stock_count > 0
                      ? `${product.stock_count} left`
                      : 'Sold out'}
                  </p>
                )}

              <div className="mt-4">
                {salesEnabled ? <BuyButton productId={product.id} soldOut={soldOut} /> : <p role="status" className="text-sm text-muted-foreground">Available to browse. Purchases are not open yet.</p>}
              </div>
            </div>

            {/* Description */}
            {product.description && (
              <div>
                <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-2">
                  About this piece
                </p>
                <p className="text-sm text-foreground font-body leading-relaxed whitespace-pre-wrap">
                  {product.description}
                </p>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
