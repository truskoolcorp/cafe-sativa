import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSiteContent } from '@/lib/content/site'
import { publiclyReleased } from '@/lib/content/member-release'

export const dynamic = 'force-dynamic'

export default async function MemberLibraryPage() {
  const { data: { user }, error } = await createClient().auth.getUser()
  if (error || !user) redirect('/auth/signin?redirect=%2Faccount%2Flibrary')
  let items: Awaited<ReturnType<typeof getSiteContent>> = []
  let unavailable = false
  try {
    items = (await getSiteContent()).filter(item => publiclyReleased({
      status: item.status, published_at: item.published_at,
      scheduled_at: item.scheduled_at, approved_at: item.approved_at,
      approved_by: item.approved_by, copy_final: item.copy_final,
    }))
  } catch { unavailable = true }
  return <main className="max-w-5xl mx-auto px-4 py-20">
    <p className="text-primary text-xs uppercase tracking-widest">Your Café Sativa</p>
    <h1 className="font-heading text-4xl font-bold mt-3">Approved programming library</h1>
    <p className="text-muted-foreground mt-4">Released venue stories and programming notes. Private media and downloads require separate approval and entitlement checks.</p>
    {unavailable ? <p role="status" className="mt-8">The library is temporarily unavailable. Please try again later.</p> : !items.length ? <p role="status" className="mt-8">No programming has been released yet.</p> : <div className="grid md:grid-cols-2 gap-5 mt-9">{items.map(item => <article key={item.id} className="bg-card rounded-xl border border-border p-6"><p className="text-xs uppercase text-primary">{(item.site_category || 'venue').replaceAll('_', ' ')}</p><h2 className="font-heading text-xl font-semibold mt-2">{item.title}</h2><p className="whitespace-pre-line text-sm text-muted-foreground mt-3">{item.copy_final}</p></article>)}</div>}
    <Link href="/account" className="inline-block text-primary underline mt-10">Back to your dashboard</Link>
  </main>
}
