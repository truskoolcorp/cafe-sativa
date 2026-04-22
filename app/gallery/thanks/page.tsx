import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { CheckCircle2, Package, Download, Gem, Home } from 'lucide-react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Button } from '@/components/ui/button'

/**
 * /gallery/thanks?session_id=cs_...
 *
 * Post-purchase confirmation. We look up the order by
 * stripe_checkout_session_id and show the relevant details.
 *
 * Timing caveat: Stripe sometimes redirects the user here before
 * the webhook has finished writing the order. We handle that by:
 *   1. Doing a single lookup on page load
 *   2. If the row isn't there yet, showing a "processing" state
 *      with a JS-driven poll (handled inline in a small client
 *      component that the server component mounts)
 *
 * For simplicity v1 just shows a static confirmation based on what
 * we can see. If no order row is found, we show a generic success
 * message — the confirmation email will have landed regardless.
 */

export const metadata: Metadata = {
  title: 'Thank you — Café Sativa',
}

export const dynamic = 'force-dynamic'

type SP = { searchParams: { session_id?: string } }

async function loadOrder(sessionId: string) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  )

  // orders_read_own RLS only lets the buyer see their own row. If
  // they somehow land here without a session, they'll see nothing —
  // which is fine, the static copy covers that.
  const { data } = await supabase
    .from('orders')
    .select(
      `
      id, total_cents, currency, fulfillment_state, created_at,
      order_items (
        product_id, title_snapshot, price_cents, quantity,
        products ( kind, digital_delivery_url )
      )
    `
    )
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle()

  return data
}

export default async function ThanksPage({ searchParams }: SP) {
  const sessionId = searchParams.session_id

  if (!sessionId) {
    return <GenericThanks />
  }

  const order = await loadOrder(sessionId)

  if (!order) {
    // Webhook likely hasn't run yet, or the user isn't signed in.
    // Show a generic confirmation — email will have the details.
    return <GenericThanks />
  }

  const item = (order.order_items as any[])?.[0]
  const product = item?.products
  const kind = product?.kind || 'physical'
  const digitalUrl = product?.digital_delivery_url

  const total = (order.total_cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: (order.currency || 'usd').toUpperCase(),
  })

  const kindIcon =
    kind === 'physical' ? Package : kind === 'digital' ? Download : Gem

  const KindIcon = kindIcon

  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-primary/40 bg-card p-8 md:p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7 text-primary" />
          </div>

          <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground mb-3 leading-tight">
            You&rsquo;re all set.
          </h1>
          <p className="text-base text-muted-foreground font-body mb-8">
            Order #{order.id.slice(0, 8)}
          </p>

          <div className="rounded-lg border border-border bg-background/50 p-5 text-left mb-8">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-1">
                  {item?.quantity || 1}× &middot; {kind}
                </p>
                <p className="font-heading text-lg font-bold text-foreground">
                  {item?.title_snapshot || 'Your piece'}
                </p>
              </div>
              <KindIcon className="w-5 h-5 text-primary shrink-0 mt-1" />
            </div>
            <div className="pt-3 border-t border-border flex items-baseline justify-between">
              <span className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold">
                Total charged
              </span>
              <span className="font-heading text-2xl font-bold text-primary">
                {total}
              </span>
            </div>
          </div>

          {kind === 'physical' && (
            <p className="text-sm text-foreground font-body leading-relaxed mb-6">
              Your order has been sent to the artist. They&rsquo;ll package it
              carefully and ship it within a few days — you&rsquo;ll get a
              tracking email when it&rsquo;s on its way.
            </p>
          )}

          {kind === 'digital' && digitalUrl && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 mb-6 text-left">
              <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-2">
                Your download
              </p>
              <a
                href={digitalUrl}
                className="text-sm font-body text-foreground hover:text-primary underline break-all"
              >
                {digitalUrl}
              </a>
              <p className="text-xs text-muted-foreground font-body mt-2">
                Also sent to your email. Access it anytime from your account.
              </p>
            </div>
          )}

          {kind === 'digital' && !digitalUrl && (
            <p className="text-sm text-foreground font-body leading-relaxed mb-6">
              Your download details are on their way by email. Check your inbox
              in the next few minutes.
            </p>
          )}

          {kind === 'nft' && (
            <p className="text-sm text-foreground font-body leading-relaxed mb-6">
              Your digital certificate is being prepared and will arrive by
              email shortly. On-chain minting to Polygon is coming in a future
              release.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button asChild>
              <Link href="/account">
                <Home className="w-4 h-4 mr-2" />
                View your orders
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/gallery">Keep browsing</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function GenericThanks() {
  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-7 h-7 text-primary" />
        </div>
        <h1 className="font-heading text-4xl font-bold text-foreground mb-4">
          Thank you.
        </h1>
        <p className="text-base text-muted-foreground font-body mb-8 leading-relaxed">
          Your order went through. A confirmation email is on its way with all
          the details.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild>
            <Link href="/account">View your orders</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/gallery">Keep browsing</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
