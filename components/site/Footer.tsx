import Link from 'next/link'
import { Coffee } from 'lucide-react'

/**
 * Site footer.
 *
 * Copy follows the Base44 PDF. The tagline "Where Nordic wellness
 * meets Canary Island culture" is the brand positioning — it appears
 * above the copyright line. The "Physical location coming 2026"
 * anchors the Tenerife story and differentiates from pure-virtual
 * venues.
 *
 * Social URLs are pulled from the profile preferences context —
 * these are the real handles, not placeholders. If any brand-level
 * social presence splits from Keith's personal handles later, these
 * become the ones to update; the personal ones stay in his profile.
 */

const EXPLORE_LINKS = [
  { href: '/stage', label: 'The Stage' },
  { href: '/gallery', label: 'The Gallery' },
  { href: '/kitchen', label: 'The Kitchen' },
  { href: '/cigar-lounge', label: 'Cigar Lounge' },
  { href: '/events', label: 'Events' },
  { href: '/ask', label: 'Ask a Host' },
]

const CONNECT_LINKS = [
  { href: 'https://www.instagram.com/truskoolcorp', label: 'Instagram', external: true },
  { href: 'https://www.tiktok.com/@truskoolcorp', label: 'TikTok', external: true },
  { href: 'https://x.com/skool_tru', label: 'X (Twitter)', external: true },
  { href: '/contact', label: 'Contact Us', external: false },
]

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
]

export function Footer() {
  return (
    <footer className="border-t border-border bg-background mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand column */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <Coffee className="w-5 h-5 text-primary" />
              <span className="font-heading text-lg font-bold text-foreground">
                Café Sativa
              </span>
            </Link>
            <p className="text-sm text-muted-foreground font-body leading-relaxed max-w-sm">
              Where Nordic wellness meets Canary Island culture.
            </p>
            <p className="text-xs text-muted-foreground/70 font-body mt-2">
              Virtual venue • Physical location opening Tenerife, Spain 2026
            </p>
          </div>

          {/* Explore column */}
          <div>
            <h3 className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-4">
              Explore
            </h3>
            <ul className="space-y-2.5">
              {EXPLORE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors font-body"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Connect column */}
          <div>
            <h3 className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-4">
              Connect
            </h3>
            <ul className="space-y-2.5">
              {CONNECT_LINKS.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors font-body"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors font-body"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <p className="text-xs text-muted-foreground/70 font-body">
            © {new Date().getFullYear()} Café Sativa. A Tru Skool Entertainment venture.
          </p>
          <nav className="flex gap-6">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors font-body"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  )
}
