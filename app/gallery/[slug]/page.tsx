import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ShieldCheck, Truck, Download, Gem } from 'lucide-react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { BuyButton } from './BuyButton'
import { Badge } from '@/components/ui/badge'

/**
 * /gallery/[slug]
 *
 * Server-rendered product detail. We look up by product slug (not by
 * id) so URLs are shareable and SEO-friendly.
 *
 * Two parts:
 *   - SSR data fetch here (title, price, image, artist, etc.)
 *   - <BuyButton> client component wrapped in interactive state for
 *     the POST to /api/gallery/checkout
 *
 * Trust signals in the sidebar change per kind:
 *   - physical: "Ships worldwide"
 *   - digital: "Delivered by email"
 *   - nft: "Digital certificate for now, on-chain mint coming"
 */

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
  return data
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

  const soldOut = product.stock_count !== null && product.stock_count <= 0
  const kindLabel =
    product.kind === 'nft' ? 'NFT' : product.kind === 'digital' ? 'Digital' : 'Physical'

  // Icon + copy for the trust-signal block
  const trustSignal =
    product.kind === 'physical'
      ? {
          icon: Truck,
          label: 'Ships worldwide',
          detail: 'Packed and shipped by the artist within a few days.',
        }
      : product.kind === 'digital'
        ? {
            icon: Download,
            label: 'Delivered instantly',
            detail: 'Download link sent to your email the moment you pay.',
          }
        : {
            icon: Gem,
            label: 'Digital certificate now, on-chain soon',
            detail:
              'You get a signed certificate of ownership via email. On-chain minting is being wired up.',
          }

  const TrustIcon = trustSignal.icon

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
            <div className="rounded-xl overflow-hidden bg-muted border border-border aspect-[4/5] lg:aspect-auto lg:min-h-[600px]">
              {product.primary_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.primary_image_url}
                  alt={product.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
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
                <BuyButton productId={product.id} soldOut={soldOut} />
              </div>
            </div>

            {/* Trust signal */}
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-start gap-3">
                <TrustIcon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-body font-semibold text-foreground text-sm">
                    {trustSignal.label}
                  </p>
                  <p className="text-xs text-muted-foreground font-body mt-0.5 leading-relaxed">
                    {trustSignal.detail}
                  </p>
                </div>
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

            {/* Platform note */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-start gap-2 text-xs text-muted-foreground font-body">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-primary/60" />
                <p className="leading-relaxed">
                  90% of every sale goes directly to {product.artist_name} via
                  Stripe. Café Sativa takes 10% to keep the lights on.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
