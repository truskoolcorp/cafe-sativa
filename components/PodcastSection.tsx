import { Headphones } from 'lucide-react'

/**
 * A "Listen" band that embeds a podcast player beneath a room's event
 * grid — the venue parallel to Off the Map on the Dallasite on Tour
 * page. Reusable across rooms: pass the show's Transistor (or other)
 * playlist embed URL and the room's copy.
 *
 * The iframe is lazy-loaded so it never competes with the page hero
 * for initial load, and carries a real title for accessibility.
 */
type PodcastSectionProps = {
  /** Small uppercase label above the title — defaults to "Listen". */
  eyebrow?: string
  /** Show name / heading. */
  title: string
  /** One or two sentences positioning the show. */
  description: string
  /** Full embed URL, e.g. a Transistor share playlist URL. */
  embedSrc: string
  /** Player height in px. Transistor playlist players default to 390. */
  height?: number
}

export function PodcastSection({
  eyebrow = 'Listen',
  title,
  description,
  embedSrc,
  height = 390,
}: PodcastSectionProps) {
  return (
    <section className="border-t border-border bg-card/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
        <div className="flex items-center gap-2 mb-3">
          <Headphones className="w-4 h-4 text-primary" />
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
            {eyebrow}
          </p>
        </div>
        <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground">
          {title}
        </h2>
        <p className="text-base text-muted-foreground font-body mt-3 max-w-2xl leading-relaxed">
          {description}
        </p>

        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
          <iframe
            src={embedSrc}
            title={`${title} — podcast player`}
            loading="lazy"
            width="100%"
            height={height}
            style={{ border: 'none', display: 'block', width: '100%' }}
          />
        </div>
      </div>
    </section>
  )
}
