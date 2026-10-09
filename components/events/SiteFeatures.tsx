import { getSiteContent } from '@/lib/content/site'
export async function SiteFeatures({category}:{category?:string}) {
  let items:any[]=[]
  try {items=await getSiteContent(category)} catch {return <p role="status">Online features are temporarily unavailable. Please try again shortly.</p>}
  if(!items.length) return null
  return <section className="mt-12" aria-label="Online features"><h2 className="font-heading text-3xl mb-6">Explore online</h2><div className="grid md:grid-cols-2 gap-6">{items.map(item=><article key={item.id} id={`feature-${item.id}`} className="border border-border bg-card rounded-xl p-6"><p className="text-primary text-sm mb-2">{item.site_category.replaceAll('_',' ')} · Read now</p><h3 className="text-xl font-heading mb-4">{item.title}</h3><div className="whitespace-pre-line leading-relaxed text-muted-foreground">{item.copy_final}</div></article>)}</div></section>
}
