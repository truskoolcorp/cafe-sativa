import Link from 'next/link'
import Image from 'next/image'
import { ArrowUpRight } from 'lucide-react'

/**
 * "Explore The Venue" — the sitemap in visual form.
 *
 * Each card represents a room in the venue that exists as its own
 * page. The eyebrow label is an orienting detail (what you do here,
 * not what it is). The image is a mood shot, not a literal
 * photograph of the space — the point is to communicate
 * atmosphere.
 *
 * Why six, not three: the Base44 prototype uses a 3×2 grid and that
 * visual rhythm works. Each card has roughly the same weight.
 * Making any one of them bigger would imply it's the main room and
 * the rest are side features, which they aren't.
 */

type Room = {
  href: string
  title: string
  eyebrow: string
  description: string
  image: string
}

const ROOMS: Room[] = [
  {
    href: '/stage',
    title: 'The Stage',
    eyebrow: 'Live performance',
    description: 'Interviews, acoustic sets, comedy, spoken word.',
    image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80',
  },
  {
    href: '/kitchen',
    title: 'The Kitchen',
    eyebrow: 'Cooking classes',
    description: 'Hands-on workshops with visiting chefs.',
    image: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=800&q=80',
  },
  {
    href: '/cigar-lounge',
    title: 'Cigar Lounge',
    eyebrow: 'Tastings & talks',
    description: 'Guided flights, blind comparisons, master blender Q&As.',
    image: 'https://images.unsplash.com/photo-1574068468668-a05a11f871da?w=800&q=80',
  },
  {
    href: '/gallery',
    title: 'The Gallery',
    eyebrow: 'Art & exhibition',
    description: 'Rotating exhibits and artist conversations.',
    image: 'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800&q=80',
  },
  {
    href: '/events',
    title: 'The Bar',
    eyebrow: 'Mixology',
    description: 'Classes and tastings with working bartenders.',
    image: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&q=80',
  },
  {
    href: '/ask',
    title: 'Ask a Host',
    eyebrow: 'Always open',
    description:
      'Talk to Laviche, Ginger, or Ahnika — our AI hosts — any time of day.',
    image: 'https://images.unsplash.com/photo-1542044896530-05d85be9b11a?w=800&q=80',
  },
]

export function ExploreVenue() {
  return (
    <section className="py-24 md:py-32 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-2xl mb-16">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-3">
            Explore The Venue
          </p>
          <h2 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
            Six rooms, one evening.
          </h2>
          <p className="text-base md:text-lg text-muted-foreground font-body mt-4 leading-relaxed">
            Wander between the stage, the kitchen, and the lounge the way you would
            at a real venue. Every room runs its own schedule.
          </p>
        </div>

        {/* Room grid — 1 col mobile, 2 col tablet, 3 col desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {ROOMS.map((room) => (
            <Link
              key={room.href}
              href={room.href}
              className="group relative aspect-[4/5] overflow-hidden rounded-xl bg-card border border-border hover:border-primary/40 transition-all duration-300"
            >
              <Image
                src={room.image}
                alt=""
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-background/20" />

              {/* Arrow indicator */}
              <div className="absolute top-4 right-4 w-9 h-9 rounded-full border border-primary/40 bg-background/60 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <ArrowUpRight className="w-4 h-4 text-primary" />
              </div>

              <div className="absolute bottom-0 inset-x-0 p-6 space-y-1">
                <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                  {room.eyebrow}
                </p>
                <h3 className="font-heading text-2xl font-bold text-foreground">
                  {room.title}
                </h3>
                <p className="text-sm text-muted-foreground font-body">
                  {room.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
