import Link from 'next/link'
import type { Metadata } from 'next'
import { getSiteContent } from '@/lib/content/site'
import { publiclyReleased } from '@/lib/content/member-release'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Explore approved experiences — Café Sativa' }

export default async function DiscoverPage() {
  let items: Awaited<ReturnType<typeof getSiteContent>> = []
  let unavailable = false
  try {
    items = (await getSiteContent()).filter(item => publiclyReleased({
      status: item.status,
      published_at: item.published_at,
      scheduled_at: item.scheduled_at,
      approved_at: item.published_at ? item.published_at : null,
      approved_by: item.published_at ? 'approved-record' : null,
      copy_final: item.copy_final,
    }))
  } catch { unavailable = true }
  return <main className="max-w-6xl mx-auto px-4 py-16">
    <p className="text-primary text-xs uppercase tracking-widest">Café Sativa</p>
    <h1 className="font-heading text-4xl font-bold mt-2">Explore approved experiences</h1>
    <p className="text-muted-foreground mt-3 max-w-2xl">Published programming from the existing editorial and canonical-media pipeline. Private recordings and member-only downloads are not exposed here.</p>
    {unavailable ? <p role="status" className="mt-8">Experiences are temporarily unavailable. Please try again.</p>
     : !items.length ? <p className="mt-8 text-muted-foreground">No approved experiences have been released yet. Check back as new content clears review.</p>
     : <div className="grid md:grid-cols-2 gap-6 mt-10">{items.map(item =>
        <article key={item.id} className="bg-card border border-border rounded-xl p-6">
          <span className="text-xs uppercase text-primary">{item.site_category.replaceAll('_',' ')}</span>
          <h2 className="font-heading text-2xl mt-2">{item.title}</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-line mt-3">{item.copy_final}</p>
        </article>
     )}</div>}
    <Link href="/account" className="inline-flex mt-10 text-primary underline underline-offset-4">Return to your account</Link>
  </main>
}
