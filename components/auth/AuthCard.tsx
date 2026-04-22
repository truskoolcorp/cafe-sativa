import Link from 'next/link'
import { Coffee } from 'lucide-react'

/**
 * Shared visual shell for the /auth/signin and /auth/signup pages.
 *
 * Both pages share a layout: full-height centered card, small
 * header with the Café Sativa logomark, then form content,
 * then a prompt at the bottom linking to the other auth page.
 *
 * This component owns the shell. The child forms (SignInForm,
 * SignUpForm) own their own state + submission logic. Separating
 * them means visual changes flow through one file instead of two,
 * and the form internals stay focused.
 *
 * A note on the full-height centering: we add `pt-16` to push the
 * card below the fixed site Navbar. Without this the card top
 * can slip under the nav on short-viewport devices.
 */

type Props = {
  title: string
  children: React.ReactNode
  /** Rendered at the bottom of the card, typically the cross-link. */
  footer?: React.ReactNode
}

export function AuthCard({ title, children, footer }: Props) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 pt-24 pb-12">
      <div className="w-full max-w-md">
        {/* Logo + brand above card — establishes context without
            needing a second nav. The link home doubles as a cancel. */}
        <Link
          href="/"
          className="flex items-center justify-center gap-2 mb-8"
        >
          <Coffee className="w-5 h-5 text-primary" />
          <span className="font-heading text-lg font-bold text-foreground">
            Café Sativa
          </span>
        </Link>

        {/* The card itself */}
        <div className="rounded-xl border border-border bg-card p-8 shadow-xl shadow-black/30">
          <h1 className="font-heading text-3xl font-bold text-foreground text-center mb-8 leading-tight">
            {title}
          </h1>
          {children}
        </div>

        {/* Cross-link below the card */}
        {footer && (
          <div className="mt-6 text-center text-sm text-muted-foreground font-body">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
