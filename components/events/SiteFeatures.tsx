import { ContentVideo } from './ContentVideo'
import { canDownloadContentMedia } from '@/lib/content/media-access'
import { getSiteContent } from '@/lib/content/site'
export async function SiteFeatures({category}:{category?:string}) {
  let items:any[]=[]
  try {items=await getSiteContent(category)} catch {return <p role="status">Online features are temporarily unavailable. Please try again shortly.</p>}
  if(!items.length) return null
  const allowDownload=await canDownloadContentMedia()
  return <section className="mt-12" aria-label="Online features"><h2 className="font-heading text-3xl mb-6">Explore online</h2><div className="grid md:grid-cols-2 gap-6">{items.map(item=><article key={item.id} id={`feature-${item.id}`} className="border border-border bg-card rounded-xl p-6"><p className="text-primary text-sm mb-2">{item.site_category.replaceAll('_',' ')} · {item.released?'Available now':'Coming soon'}</p><h3 className="text-xl font-heading mb-4">{item.title}</h3>{!item.media_url && <img src={item.site_category==='bar'?'https://nwfxvhqbjtfvoopcadff.supabase.co/storage/v1/object/public/cafe-sativa-canon/bar-pilot-2026-10-07.png':`/rooms/${item.site_category}.webp`} alt={`${item.site_category.replaceAll('_',' ')} cover`} className="w-full max-h-[480px] object-cover rounded-lg mb-4"/>}{!item.released && <p className="mb-4 font-semibold">{item.release_at?`Releases ${new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short'}).format(new Date(item.release_at))} (Chicago time)`:'Release date to be confirmed'}</p>}{item.media_url && <ContentVideo src={item.media_url} allowDownload={allowDownload} poster={item.site_category==='bar'?'https://nwfxvhqbjtfvoopcadff.supabase.co/storage/v1/object/public/cafe-sativa-canon/bar-pilot-2026-10-07.png':`/rooms/${item.site_category}.webp`}/>}<div className="whitespace-pre-line leading-relaxed text-muted-foreground">{item.copy_final}</div></article>)}</div></section>
}
