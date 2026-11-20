import Link from 'next/link'
import {notFound} from 'next/navigation'
import {createAdminClient} from '@/lib/supabase/admin'
import {publicRelease} from '@/lib/content/music-release-contract'
export const dynamic='force-dynamic'
export default async function MusicRelease({params}:{params:{slug:string}}){
 const db=createAdminClient(),row=await db.from('cs_music_releases').select('*').eq('slug',params.slug).maybeSingle()
 if(row.error||!publicRelease(row.data))notFound()
 const r=row.data,m=r.manifest
 return <main className="mx-auto max-w-3xl px-6 py-20"><p>Café Sativa · Music</p><h1 className="text-4xl font-bold my-6">{m.title}</h1><p className="mb-6">{m.description}</p><video controls playsInline preload="metadata" className="w-full max-h-[70vh]" src={`/api/music/teaser/${r.id}`}/><p className="my-6">Full performance available to VIP members from {new Date(m.releaseAt).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})}.</p><div className="flex gap-6"><Link href={`/membership?release=${m.slug}`}>Explore VIP membership</Link><Link href="/vip/recordings">Member replay library</Link></div></main>
}
