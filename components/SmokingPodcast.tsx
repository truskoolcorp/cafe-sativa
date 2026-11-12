import Link from 'next/link'
import { PodcastSection } from '@/components/PodcastSection'
import { getLatestPodcastVideo } from '@/lib/podcast-video'

export async function SmokingPodcast() {
  const latest = await getLatestPodcastVideo()
  return <>
    <section className="border-t border-border bg-card/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <p className="text-xs uppercase tracking-widest text-primary font-semibold">The latest conversation</p>
        <h2 className="font-heading text-3xl font-bold mt-3">What Are You Smoking?</h2>
        <p className="text-muted-foreground mt-3">Pull up a chair with Don Aurelio Vanté. Cigar culture, curiosity, and conversation, every other week.</p>
        {latest ? <>
          <h3 className="font-heading text-xl mt-6">{latest.title}</h3>
          <div className="aspect-video mt-4 overflow-hidden rounded-xl border border-border">
            <iframe className="w-full h-full" src={`https://www.youtube-nocookie.com/embed/${latest.id}?rel=0&playsinline=1`} title={latest.title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          </div>
        </> : <p role="status" className="mt-6 rounded-xl border border-border p-6">The next video conversation is being prepared. Listen to released episodes below.</p>}
        <div className="mt-6 rounded-xl border border-border p-6">
          <h3 className="font-heading text-xl">VIP video archive</h3>
          <p className="text-muted-foreground mt-2">VIP members can watch past video conversations once they are released to the private recording library.</p>
          <Link href="/vip/recordings" className="inline-block mt-4 text-primary underline">Open VIP recordings →</Link>
          <Link href="/membership" className="inline-block mt-4 ml-6 text-primary underline">Explore VIP membership</Link>
        </div>
      </div>
    </section>
    <PodcastSection title="Listen to What Are You Smoking?" description="Prefer audio? Listen to the public podcast edition here." embedSrc="https://share.transistor.fm/e/what-are-you-smoking/playlist" />
  </>
}
