import { approvedVenueCovers } from '@/lib/content/venue-covers'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Package } from 'lucide-react'
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
    'Original work from our resident artists. Explore physical and digital artwork and the stories behind it.',
}

export const dynamic = 'force-dynamic'

type GalleryRow = {
  id: string
  slug: string
  title: string
  description: string | null
  kind: 'physical' | 'digital'
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
    .in('kind', ['physical', 'digital'])
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) {
    console.error('[/gallery] load failed', error)
    return []
  }

  return (data as GalleryRow[]) || []
}

export default async function GalleryPage({ searchParams }: { searchParams: { kind?: string } }) {
  const [products, covers] = await Promise.all([loadGallery(), approvedVenueCovers()])

  const kind = ['physical', 'digital'].includes(searchParams.kind || '') ? searchParams.kind : undefined
  const visibleProducts = kind ? products.filter(p => p.kind === kind) : products
  return (
    <div className="pb-16 bg-background min-h-screen">
      <section aria-labelledby="gallery-title" className="relative isolate overflow-hidden bg-[#171310] text-[#f9efe1]">
        <div className="relative min-h-[520px] md:min-h-[660px] flex items-end">
          {covers.gallery && <Image src={covers.gallery} alt="" fill priority sizes="100vw" className="object-cover object-center" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[#171310] via-[#171310]/55 to-black/20"/>
          <div className="relative w-full max-w-7xl mx-auto px-6 lg:px-12 py-16 md:py-24">
            <p className="text-xs uppercase tracking-[0.32em] text-[#e6bc8f]">Café Sativa · The Gallery</p>
            <h1 id="gallery-title" className="font-heading text-5xl sm:text-6xl lg:text-8xl leading-[1.05] mt-5 max-w-3xl">Art worth<br/><em className="text-[#e6bc8f] font-normal">staying for.</em></h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-[#f9efe1]/90">A warm, intimate space for art, artists and the stories behind their work.</p>
            <div className="mt-8 flex flex-wrap gap-4 items-center">
              <a href="#inside-gallery" className="inline-flex bg-[#e6bc8f] text-[#171310] rounded-sm px-7 py-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">Step inside <span aria-hidden="true" className="ml-3">↓</span></a>
              <a href="#artwork" className="underline underline-offset-4 py-3">Explore the collection</a>
            </div>
          </div>
        </div>
      </section>
      <section id="inside-gallery" aria-labelledby="gallery-tour-heading" className="scroll-mt-24 max-w-7xl mx-auto px-6 lg:px-12 py-14 md:py-20">
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-8 lg:gap-14 items-center">
          <div className="overflow-hidden rounded-sm bg-card border border-border">
            {covers.gallery ? <div className="relative aspect-video"><Image src={covers.gallery} alt="Approved Café Sativa Gallery interior" fill sizes="(min-width:1024px) 60vw, 100vw" className="object-cover"/></div> : <div className="aspect-video flex items-center justify-center text-muted-foreground">Gallery preview unavailable</div>}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">01 / The space</p>
            <h2 id="gallery-tour-heading" className="font-heading text-4xl md:text-5xl mt-3">Take in the room.</h2>
            <p className="text-muted-foreground leading-relaxed mt-4">Take a look inside the Café Sativa Gallery.</p>
            <a href="#curator-heading" className="inline-block mt-5 underline underline-offset-4 text-primary">Meet your curator</a>
          </div>
        </div>
      </section>
      <section aria-labelledby="curator-heading" className="bg-card border-y border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-12 grid md:grid-cols-[1fr_2fr] gap-8 items-center">
          <div aria-hidden="true" className="font-heading text-6xl md:text-8xl text-primary/70 border-l border-primary pl-6">ZS</div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary">02 / Curator’s perspective</p>
            <h2 id="curator-heading" className="font-heading text-4xl mt-3">Meet Zaria Solenne.</h2>
            <p className="text-muted-foreground mt-4 max-w-xl leading-relaxed">Discover the creative practice behind the work, explore different media, and learn how collecting supports artists. Only approved pieces and confirmed exhibition details appear here.</p>
          </div>
        </div>
      </section>
      {/* Grid */}
      <div id="artwork" className="scroll-mt-24 max-w-7xl mx-auto px-6 lg:px-12 py-14 md:py-20">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">03 / The collection</p>
        <h2 className="font-heading text-4xl md:text-5xl mt-3 mb-6">Discover the work.</h2>
        <nav aria-label="Artwork categories" className="flex flex-wrap gap-2 mb-6">
          {[['All work',''],['Physical','physical'],['Digital','digital']].map(([label,value]) => (
            <Link key={label} href={value ? '/gallery?kind='+value : '/gallery'} aria-current={(kind || '') === value ? 'page' : undefined} className={'rounded-full border px-4 py-2 text-sm '+((kind || '') === value ? 'border-primary text-primary' : 'border-border text-muted-foreground')}>{label}</Link>
          ))}
        </nav>
        {products.length === 0 ? (
          <EmptyGallery />
        ) : visibleProducts.length === 0 ? (
          <p role="status" className="text-muted-foreground py-8">No published work in this category yet. <Link href="/gallery" className="underline">Browse all work.</Link></p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {visibleProducts.map((p) => (
              <GalleryCard key={p.id} row={p} />
            ))}
          </div>
        )}
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">Some works in the Gallery are created wholly or partly with AI.</p>
      </div>
      <section className="max-w-7xl mx-auto px-6 lg:px-12 pb-12" aria-labelledby="editorial-heading">
        <p className="text-xs uppercase tracking-[0.24em] text-primary">04 / Gallery journal</p>
        <h2 id="editorial-heading" className="font-heading text-4xl mt-3 mb-6">Beyond the frame.</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <article className="border-t border-primary/40 pt-5"><h3 className="font-heading text-2xl">A space for artists</h3><p className="mt-3 text-muted-foreground">Discover original work across physical and digital media. Artists can manage submissions through the existing artist dashboard.</p><Link href="/artist-dashboard" className="inline-block mt-4 text-primary underline">Artist dashboard</Link></article>
        </div>
      </section>
    </div>
  )
}

function GalleryCard({ row }: { row: GalleryRow }) {
  const priceUsd = (row.price_cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: (row.currency || 'usd').toUpperCase(),
  })
  const kindLabel = row.kind === 'digital' ? 'Digital art' : 'Physical'

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
            className="w-full h-full object-cover motion-safe:group-hover:scale-[1.03] motion-safe:transition-transform duration-500"
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
  return <div className="grid md:grid-cols-2 gap-6 border-t border-border pt-8">
    <article className="bg-card p-6 md:p-8"><p className="text-xs uppercase tracking-widest text-primary">Curator’s note</p><h3 className="font-heading text-3xl mt-3">The first collection is taking shape.</h3><p className="mt-4 text-muted-foreground leading-relaxed">No approved artwork is on display just yet. Take a look around and meet the Gallery’s curator.</p><a href="#curator-heading" className="inline-block mt-6 underline text-primary">Meet the curator</a></article>
    <article className="border border-border p-6 md:p-8"><p className="text-xs uppercase tracking-widest text-primary">Collector’s guide</p><h3 className="font-heading text-3xl mt-3">Find your medium.</h3><p className="mt-4 text-muted-foreground leading-relaxed">Physical works and digital editions have different ownership and delivery terms. Explore the work without a sales commitment.</p><Link href="/events" className="inline-block mt-6 underline text-primary">Browse venue programming</Link></article>
  </div>
}
