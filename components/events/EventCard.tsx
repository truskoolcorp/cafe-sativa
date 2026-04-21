import Link from 'next/link'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Calendar, Clock, Lock } from 'lucide-react'
import { formatEventDate, formatPrice, type EventRow } from '@/lib/events'
import { cn } from '@/lib/utils'

/**
 * A single event card used on the category pages (/stage, /kitchen,
 * /cigar-lounge). Matches the Base44 prototype's card density: image
 * on top, metadata block below, price/access cue on the bottom-right.
 *
 * The optional `requiresVipGate` prop dims the card and stamps a
 * lock icon on events that require VIP membership the current
 * visitor doesn't have. The view's `access` field already tells us
 * this (access='purchase_required' + free_for_tiers contains 'vip')
 * so we don't leak ticket data — we just present it accordingly.
 */

type Props = {
  event: EventRow
  /** When true, card shows a lock overlay and mutes the palette. */
  vipGated?: boolean
}

function accessLabel(access: EventRow['access'], price: number): string {
  if (access === 'ticketed') return 'You have a ticket'
  if (access === 'free') return 'Free to join'
  if (access === 'tier_included') return 'Included in your plan'
  return formatPrice(price)
}

// Fallback image if event has no hero — each category gets a
// different mood photo so the page still feels curated.
const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  stage: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80',
  kitchen: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=800&q=80',
  cigar_lounge:
    'https://images.unsplash.com/photo-1574068468668-a05a11f871da?w=800&q=80',
  bar: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&q=80',
  gallery:
    'https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=800&q=80',
  community:
    'https://images.unsplash.com/photo-1542044896530-05d85be9b11a?w=800&q=80',
}

export function EventCard({ event, vipGated }: Props) {
  const date = formatEventDate(event.starts_at)
  const fallback = event.category
    ? CATEGORY_FALLBACK_IMAGES[event.category]
    : undefined
  const image = event.hero_image_url || fallback

  return (
    <Link
      href={`/events/${event.slug}`}
      className={cn(
        'group block rounded-xl border bg-card overflow-hidden transition-all duration-300',
        vipGated
          ? 'border-border/50 opacity-70 hover:opacity-100 hover:border-primary/40'
          : 'border-border hover:border-primary/40'
      )}
    >
      {/* Image */}
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {image && (
          <Image
            src={image}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent" />

        {/* VIP gate overlay */}
        {vipGated && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[2px]">
            <div className="flex items-center gap-2 rounded-full bg-background/90 border border-primary/40 px-4 py-2">
              <Lock className="w-4 h-4 text-primary" />
              <span className="text-xs tracking-widest uppercase text-primary font-body font-semibold">
                VIP Only
              </span>
            </div>
          </div>
        )}

        {/* Featured badge */}
        {event.is_featured && !vipGated && (
          <div className="absolute top-3 left-3">
            <Badge className="font-body">Featured</Badge>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-6 space-y-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground font-body">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="w-3 h-3" />
            {date.weekdayShort}, {date.dateShort}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            {date.time}
          </span>
        </div>

        <div>
          <h3 className="font-heading text-xl font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
            {event.title}
          </h3>
          {event.subtitle && (
            <p className="text-sm text-muted-foreground font-body mt-1 line-clamp-1">
              {event.subtitle}
            </p>
          )}
        </div>

        {event.presenter_name && (
          <p className="text-sm text-foreground/80 font-body">
            <span className="text-muted-foreground">With</span>{' '}
            {event.presenter_name}
            {event.presenter_role && (
              <span className="text-muted-foreground">
                {' '}
                · {event.presenter_role}
              </span>
            )}
          </p>
        )}

        {event.description && (
          <p className="text-sm text-muted-foreground font-body line-clamp-2">
            {event.description}
          </p>
        )}

        <div className="pt-3 border-t border-border flex items-center justify-between">
          <span className="text-sm font-body text-foreground font-semibold">
            {accessLabel(event.access, event.ticket_price_cents)}
          </span>
          <span className="text-xs text-primary font-body">Details →</span>
        </div>
      </div>
    </Link>
  )
}
