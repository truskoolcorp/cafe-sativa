'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Primary site navigation.
 *
 * Sticky at top, transparent on scroll-top, solid-with-blur once the
 * user scrolls past ~40px. That gives the hero image on the homepage
 * room to breathe without a chrome bar sitting across it. On other
 * pages (which start with their own hero) the same pattern still
 * reads correctly because the nav only becomes fully opaque after the
 * first section ends.
 *
 * Nav items are the six rooms promised on the Home page + Events.
 * Membership and Account sit on the right because they're
 * account-layer concerns, not venue-browsing concerns. Ask is
 * surfaced too — it's the unique thing Café Sativa has that other
 * event venues don't, and it converts better when it's always one
 * click away.
 */

const NAV_LINKS = [
  { href: '/events', label: 'Events' },
  { href: '/stage', label: 'The Stage' },
  { href: '/kitchen', label: 'The Kitchen' },
  { href: '/cigar-lounge', label: 'Cigar Lounge' },
  { href: '/gallery', label: 'The Gallery' },
  { href: '/ask', label: 'Ask' },
]

export function Navbar() {
  const router = useRouter()
  const pathname = usePathname()

  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  // Scroll → switch between translucent and solid nav background.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close mobile menu on route change. Without this a visitor taps a
  // link, the page changes, but the menu stays open covering the new page.
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Auth state — copied pattern from the old AuthNav so behavior is
  // identical. Live subscription means sign-in/sign-out reflects in
  // the navbar without a full page reload.
  useEffect(() => {
    let mounted = true
    let subscription: { unsubscribe: () => void } | null = null

    async function loadSession() {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        if (!mounted) return
        setUserEmail(data.user?.email ?? null)

        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          setUserEmail(session?.user?.email ?? null)
          router.refresh()
        })
        subscription = sub.subscription
      } catch {
        if (mounted) setUserEmail(null)
      } finally {
        if (mounted) setAuthLoading(false)
      }
    }

    loadSession()

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  }, [router])

  async function handleSignOut() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/')
      router.refresh()
    } catch (err) {
      console.error('Sign out failed:', err)
    }
  }

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-background/85 backdrop-blur-md border-b border-border'
          : 'bg-transparent'
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="font-heading text-xl font-bold tracking-tight text-primary">
              Café Sativa
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(link.href + '/')
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm font-body transition-colors',
                    active
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>

          {/* Right side — membership + auth */}
          <div className="hidden lg:flex items-center gap-2">
            <Link
              href="/membership"
              className={cn(
                'px-3 py-2 rounded-md text-sm font-body transition-colors',
                pathname === '/membership'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Membership
            </Link>

            {authLoading ? (
              <div className="w-20 h-8" /> /* placeholder to avoid layout shift */
            ) : userEmail ? (
              <>
                <Link
                  href="/account"
                  className="px-3 py-2 rounded-md text-sm font-body text-muted-foreground hover:text-foreground transition-colors"
                >
                  Account
                </Link>
                <Button variant="outline" size="sm" onClick={handleSignOut}>
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/signin"
                  className="px-3 py-2 rounded-md text-sm font-body text-muted-foreground hover:text-foreground transition-colors"
                >
                  Sign in
                </Link>
                <Button size="sm" asChild>
                  <Link href="/auth/signup">Join free</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-md text-foreground hover:bg-accent"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border bg-background/95 backdrop-blur-md">
          <nav className="px-4 py-6 space-y-1 max-w-7xl mx-auto">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-3 py-2 rounded-md text-base font-body text-foreground hover:bg-accent transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/membership"
              className="block px-3 py-2 rounded-md text-base font-body text-foreground hover:bg-accent transition-colors"
            >
              Membership
            </Link>
            <div className="pt-4 mt-4 border-t border-border space-y-2">
              {userEmail ? (
                <>
                  <Link
                    href="/account"
                    className="block px-3 py-2 rounded-md text-base font-body text-foreground hover:bg-accent transition-colors"
                  >
                    Account
                  </Link>
                  <Button variant="outline" className="w-full" onClick={handleSignOut}>
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/auth/signin">Sign in</Link>
                  </Button>
                  <Button className="w-full" asChild>
                    <Link href="/auth/signup">Join free</Link>
                  </Button>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
