import { SiteFeatures } from '@/components/events/SiteFeatures'
import Link from 'next/link'
export const dynamic='force-dynamic'
export default function VenueTours() {
 return <main className="max-w-7xl mx-auto px-4 pt-32 pb-20"><h1 className="font-heading text-4xl mb-6">Virtual venue tours</h1><p className="text-muted-foreground mb-6">Explore approved Café Sativa Main Lounge, Courtyard and Cold Stoned concept previews. The physical Tenerife venue is planned for 2027; its exact property and opening date are unconfirmed.</p><Link className="text-primary underline" href="/events">Explore Stage, Kitchen, Cigar Lounge, Bar, Gallery and Community programming →</Link><SiteFeatures category="venue" /></main>
}
