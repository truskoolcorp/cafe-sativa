'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, Loader2, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

/**
 * Buy button for /gallery/[slug].
 *
 * Flow:
 *   1. Not signed in  → bounce to /auth/signin?redirect=/gallery/<slug>
 *      Checkout requires auth so we can link the order to the user.
 *   2. Signed in      → POST /api/gallery/checkout, navigate to Stripe.
 *
 * Also surfaces ?canceled=1 on return from Stripe cancel.
 */

export function BuyButton({
  productId,
  soldOut,
}: {
  productId: string
  soldOut: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canceledBanner, setCanceledBanner] = useState(false)

  useEffect(() => {
    if (searchParams.get('canceled') === '1') {
      setCanceledBanner(true)
    }
  }, [searchParams])

  async function handleBuy() {
    setSubmitting(true)
    setError(null)

    // Auth check first — if not signed in, redirect through signin
    // so we come back here after.
    const supabase = createClient()
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) {
      const slugFromUrl = window.location.pathname
      router.push(
        `/auth/signin?redirect=${encodeURIComponent(slugFromUrl)}`
      )
      return
    }

    try {
      const res = await fetch('/api/gallery/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, quantity: 1 }),
      })
      const data = await res.json()

      if (!res.ok) {
        // 401 slipped past our auth check (session expired after getUser)
        if (res.status === 401) {
          const slugFromUrl = window.location.pathname
          router.push(
            `/auth/signin?redirect=${encodeURIComponent(slugFromUrl)}`
          )
          return
        }
        setError(data?.error || 'Could not start checkout.')
        setSubmitting(false)
        return
      }

      if (data.url) {
        window.location.href = data.url
        return
      }

      setError('No checkout URL returned.')
      setSubmitting(false)
    } catch (err: any) {
      setError(err?.message || 'Checkout failed.')
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      {canceledBanner && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <p className="text-sm text-foreground font-body">
            Checkout canceled. No charge was made.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-foreground font-body">{error}</p>
          </div>
        </div>
      )}

      <Button
        size="lg"
        className="w-full"
        onClick={handleBuy}
        disabled={submitting || soldOut}
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Starting checkout…
          </>
        ) : soldOut ? (
          'Sold out'
        ) : (
          <>
            <ShoppingBag className="w-4 h-4 mr-2" />
            Buy now
          </>
        )}
      </Button>
    </div>
  )
}
