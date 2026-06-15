'use client'
import Link from 'next/link'

/**
 * Shown on the event detail page when the user already has a valid ticket.
 * Replaces the plain disabled 'You're in' button with a two-button stack:
 *   1. A muted 'You're in ✓' confirmation (disabled, non-interactive)
 *   2. A gold 'Join Event →' button linking to /events/[slug]/watch
 *
 * Usage: drop this in place of the single disabled Button in the ticket card.
 */
export function TicketedCTA({ slug }: { slug: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      {/* Confirmation badge */}
      <div
        style={{
          width: '100%', padding: '12px 16px', borderRadius: 6,
          background: '#1a1200', border: '1px solid #3d2a12',
          color: '#6b5540', fontSize: 14, fontWeight: 700,
          textAlign: 'center', letterSpacing: '0.02em', boxSizing: 'border-box',
        }}
      >
        ✓ You&apos;re in
      </div>

      {/* Join event room */}
      <Link
        href={`/events/${slug}/watch`}
        style={{
          display: 'block', width: '100%', padding: '13px 16px',
          borderRadius: 6, background: '#b8813a',
          color: '#0d0a07', fontSize: 14, fontWeight: 700,
          textDecoration: 'none', textAlign: 'center',
          letterSpacing: '0.02em', boxSizing: 'border-box',
        }}
      >
        Join Event →
      </Link>
    </div>
  )
}
