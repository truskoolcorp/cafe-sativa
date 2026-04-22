'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * /artist-dashboard
 *
 * Four states this page has to handle:
 *
 *   1. Not signed in        → bounce to /auth/signin?redirect=/artist-dashboard
 *   2. Signed in, no artist → show onboarding CTA (create profile + Connect)
 *   3. Artist pending       → show status, "Resume onboarding" button
 *   4. Artist active        → show products, new-product form
 *
 * The state machine is driven by the `artists` row:
 *   - null row                                 → state 2
 *   - onboarding_state='none' or 'pending'     → state 3
 *   - onboarding_state='active' + is_approved  → state 4
 *   - onboarding_state='rejected'              → state 3 with warning
 *
 * Query-param signals from Stripe onboarding return:
 *   - ?onboarding=complete → trigger sync immediately
 *   - ?onboarding=refresh  → trigger sync immediately (link expired)
 *
 * Product creation is inline (no separate /artist-dashboard/new page)
 * because v1 has maybe 5 fields. If this grows past ~10, split it.
 */

type Artist = {
  id: string
  display_name: string
  slug: string
  bio: string | null
  stripe_account_id: string | null
  onboarding_state: 'none' | 'pending' | 'active' | 'rejected'
  payouts_enabled: boolean
  charges_enabled: boolean
  is_approved: boolean
}

type Product = {
  id: string
  slug: string
  title: string
  kind: 'physical' | 'digital' | 'nft'
  status: 'draft' | 'published' | 'archived'
  price_cents: number
  primary_image_url: string | null
  stock_count: number | null
  created_at: string
}

export default function ArtistDashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <ArtistDashboardInner />
    </Suspense>
  )
}

function DashboardSkeleton() {
  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="h-10 w-64 bg-muted rounded animate-pulse" />
          <div className="h-48 rounded-xl border border-border bg-card/50 animate-pulse" />
        </div>
      </div>
    </div>
  )
}

function ArtistDashboardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [artist, setArtist] = useState<Artist | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      setSignedIn(false)
      setLoading(false)
      router.push('/auth/signin?redirect=/artist-dashboard')
      return
    }

    setSignedIn(true)

    const { data: artistRow } = await supabase
      .from('artists')
      .select(
        'id, display_name, slug, bio, stripe_account_id, onboarding_state, payouts_enabled, charges_enabled, is_approved'
      )
      .eq('user_id', userData.user.id)
      .maybeSingle()

    setArtist(artistRow as Artist | null)

    if (artistRow) {
      // RLS policy products_read_own lets the artist see their own
      // drafts + published + archived rows.
      const { data: productRows } = await supabase
        .from('products')
        .select(
          'id, slug, title, kind, status, price_cents, primary_image_url, stock_count, created_at'
        )
        .eq('artist_id', artistRow.id)
        .order('created_at', { ascending: false })

      setProducts((productRows as Product[]) || [])
    }

    setLoading(false)
  }, [supabase, router])

  useEffect(() => {
    load()
  }, [load])

  // Auto-sync when returning from Stripe onboarding.
  useEffect(() => {
    const trigger = searchParams.get('onboarding')
    if (trigger === 'complete' || trigger === 'refresh') {
      void handleSync()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/artists/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Sync failed.')
      }
      await load()
    } catch (err: any) {
      setError(err?.message || 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  // Loading screen
  if (loading || signedIn === null) {
    return (
      <div className="pt-24 pb-16 bg-background min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            <div className="h-10 w-64 bg-muted rounded animate-pulse" />
            <div className="h-48 rounded-xl border border-border bg-card/50 animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  // State 2: no artist row — first-time onboarding
  if (!artist) {
    return <FirstTimeOnboarding onCreated={load} />
  }

  // States 3 + 4
  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-2">
              Artist dashboard
            </p>
            <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
              {artist.display_name}
            </h1>
            <p className="text-sm text-muted-foreground font-body mt-1">
              /gallery/artist/{artist.slug}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw
              className={cn('w-4 h-4 mr-2', syncing && 'animate-spin')}
            />
            {syncing ? 'Syncing…' : 'Sync Stripe'}
          </Button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-foreground font-body">{error}</p>
            </div>
          </div>
        )}

        {/* Onboarding status card */}
        <OnboardingStatusCard artist={artist} />

        {/* Products only once onboarding is live */}
        {artist.is_approved && (
          <div className="mt-10 space-y-6">
            <NewProductForm artistId={artist.id} onCreated={load} />

            <div>
              <h2 className="font-heading text-2xl font-bold text-foreground mb-4">
                Your work
              </h2>
              {products.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
                  <Package className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground font-body">
                    No products yet. Use the form above to add one.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {products.map((p) => (
                    <ProductTile key={p.id} product={p} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// First-time onboarding card (state 2)
// ============================================================
function FirstTimeOnboarding({ onCreated }: { onCreated: () => void }) {
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/artists/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName.trim(),
          bio: bio.trim() || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data?.code === 'connect_not_activated') {
          setError(
            'Stripe Connect isn\u2019t activated on this platform yet. The site owner needs to activate it in the Stripe Dashboard first.'
          )
        } else {
          setError(data?.error || 'Could not start onboarding.')
        }
        setSubmitting(false)
        return
      }

      // Stripe gave us an Account Link — redirect the top window
      if (data.url) {
        window.location.href = data.url
        return
      }

      // No URL → creation succeeded but link generation didn't. Refresh.
      onCreated()
    } catch (err: any) {
      setError(err?.message || 'Could not start onboarding.')
      setSubmitting(false)
    }
  }

  return (
    <div className="pt-24 pb-16 bg-background min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-xs tracking-widest uppercase text-primary font-body font-semibold mb-2">
            Become an artist
          </p>
          <h1 className="font-heading text-4xl md:text-5xl font-bold text-foreground leading-tight">
            Sell your work in the Gallery.
          </h1>
          <p className="text-base text-muted-foreground font-body mt-4 leading-relaxed">
            Original work, editions, digital pieces, or NFTs. We take 10% of
            each sale; the rest flows straight to your connected bank account
            via Stripe. Onboarding takes about five minutes.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-foreground font-body">{error}</p>
            </div>
          </div>
        )}

        <form
          onSubmit={handleStart}
          className="rounded-xl border border-border bg-card p-6 space-y-5"
        >
          <div>
            <label
              htmlFor="display_name"
              className="block text-sm font-body font-semibold text-foreground mb-2"
            >
              Artist name or alias
            </label>
            <Input
              id="display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="The name buyers will see"
              required
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground font-body mt-1.5">
              Can be your real name, an alias, or a collective name.
            </p>
          </div>

          <div>
            <label
              htmlFor="bio"
              className="block text-sm font-body font-semibold text-foreground mb-2"
            >
              Short bio{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="A sentence or two about your practice."
              disabled={submitting}
              className="w-full resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm font-body text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            />
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-body text-foreground leading-relaxed">
              <strong className="text-primary">Next:</strong> Stripe will ask
              for your legal name, tax info, and a bank account for payouts.
              Your sensitive info goes to Stripe, not us.
            </p>
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting || !displayName.trim()}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting onboarding…
              </>
            ) : (
              <>
                Continue to Stripe
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}

// ============================================================
// Onboarding status card (states 3 + 4)
// ============================================================
function OnboardingStatusCard({ artist }: { artist: Artist }) {
  const [redirecting, setRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resumeOnboarding() {
    setRedirecting(true)
    setError(null)
    try {
      const res = await fetch('/api/artists/onboard', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Could not resume onboarding.')
        setRedirecting(false)
        return
      }
      if (data.url) {
        window.location.href = data.url
        return
      }
      setError('Onboarding link was not returned. Try refresh.')
      setRedirecting(false)
    } catch (err: any) {
      setError(err?.message || 'Could not resume onboarding.')
      setRedirecting(false)
    }
  }

  // Status pill
  const pill = (() => {
    if (artist.onboarding_state === 'active' && artist.is_approved) {
      return (
        <Badge className="bg-primary/10 border-primary/40 text-primary">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Active
        </Badge>
      )
    }
    if (artist.onboarding_state === 'rejected') {
      return (
        <Badge variant="destructive">
          <XCircle className="w-3 h-3 mr-1" />
          More info needed
        </Badge>
      )
    }
    return (
      <Badge variant="outline">
        <Loader2 className="w-3 h-3 mr-1" />
        Onboarding pending
      </Badge>
    )
  })()

  const showResume =
    artist.onboarding_state !== 'active' || !artist.is_approved

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-xs tracking-widest uppercase text-muted-foreground font-body font-semibold mb-2">
            Payout account
          </p>
          <div className="flex items-center gap-3">
            <h2 className="font-heading text-xl font-bold text-foreground">
              Stripe Connect
            </h2>
            {pill}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4 text-sm font-body">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-widest mb-1">
            Charges
          </p>
          <p
            className={cn(
              'font-semibold',
              artist.charges_enabled ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            {artist.charges_enabled ? 'Enabled' : 'Not yet'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-widest mb-1">
            Payouts
          </p>
          <p
            className={cn(
              'font-semibold',
              artist.payouts_enabled ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            {artist.payouts_enabled ? 'Enabled' : 'Not yet'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <p className="text-sm text-foreground font-body">{error}</p>
        </div>
      )}

      {showResume && (
        <div className="mt-6 pt-6 border-t border-border">
          <p className="text-sm text-muted-foreground font-body mb-4">
            {artist.onboarding_state === 'rejected'
              ? 'Stripe needs more information before your account can accept payments.'
              : 'Finish the Stripe flow to start selling. Your draft products are saved and will publish once you\u2019re approved.'}
          </p>
          <Button
            onClick={resumeOnboarding}
            disabled={redirecting}
            variant={artist.onboarding_state === 'rejected' ? 'default' : 'outline'}
          >
            {redirecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Redirecting…
              </>
            ) : (
              <>
                Resume Stripe onboarding
                <ExternalLink className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// New product form (state 4 only)
// ============================================================
function NewProductForm({
  artistId,
  onCreated,
}: {
  artistId: string
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'physical' | 'digital' | 'nft'>('physical')
  const [price, setPrice] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [description, setDescription] = useState('')
  const [stock, setStock] = useState('')
  const [weight, setWeight] = useState('')
  const [deliveryUrl, setDeliveryUrl] = useState('')
  const [blockchain, setBlockchain] = useState<'polygon' | 'ethereum' | 'base'>(
    'polygon'
  )
  const [publishNow, setPublishNow] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(false)

    const priceNum = parseFloat(price)
    if (isNaN(priceNum) || priceNum < 0) {
      setError('Enter a valid price.')
      setSubmitting(false)
      return
    }

    const payload: Record<string, any> = {
      title: title.trim(),
      description: description.trim() || undefined,
      kind,
      price_cents: Math.round(priceNum * 100),
      primary_image_url: imageUrl.trim() || undefined,
      stock_count: stock.trim() ? parseInt(stock.trim(), 10) : null,
      status: publishNow ? 'published' : 'draft',
    }
    if (kind === 'physical' && weight.trim()) {
      payload.weight_grams = parseInt(weight.trim(), 10)
    }
    if (kind === 'digital' && deliveryUrl.trim()) {
      payload.digital_delivery_url = deliveryUrl.trim()
    }
    if (kind === 'nft') {
      payload.blockchain = blockchain
    }

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data?.error || 'Could not save product.')
        setSubmitting(false)
        return
      }

      setSuccess(true)
      setTitle('')
      setDescription('')
      setPrice('')
      setImageUrl('')
      setStock('')
      setWeight('')
      setDeliveryUrl('')
      onCreated()
    } catch (err: any) {
      setError(err?.message || 'Save failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-5">
        <Plus className="w-5 h-5 text-primary" />
        <h2 className="font-heading text-xl font-bold text-foreground">
          Add a product
        </h2>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <p className="text-sm text-foreground font-body">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <p className="text-sm text-foreground font-body">
            <CheckCircle2 className="w-4 h-4 inline -mt-0.5 mr-1.5 text-primary" />
            Saved.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Kind selector */}
        <div>
          <label className="block text-sm font-body font-semibold text-foreground mb-2">
            Kind
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['physical', 'digital', 'nft'] as const).map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  'rounded-lg border px-4 py-2.5 text-sm font-body font-semibold transition-colors',
                  kind === k
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                )}
              >
                {k === 'nft' ? 'NFT' : k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-body font-semibold text-foreground mb-2"
          >
            Title
          </label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={submitting}
            placeholder='e.g. "Stormfront No. 3"'
          />
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="description"
            className="block text-sm font-body font-semibold text-foreground mb-2"
          >
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            disabled={submitting}
            placeholder="Materials, dimensions, story — whatever helps the buyer decide."
            className="w-full resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm font-body text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
        </div>

        {/* Price + stock */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="price"
              className="block text-sm font-body font-semibold text-foreground mb-2"
            >
              Price (USD)
            </label>
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              disabled={submitting}
              placeholder="0.00"
            />
          </div>
          <div>
            <label
              htmlFor="stock"
              className="block text-sm font-body font-semibold text-foreground mb-2"
            >
              Stock{' '}
              <span className="text-muted-foreground font-normal">
                (blank = unlimited)
              </span>
            </label>
            <Input
              id="stock"
              type="number"
              min="0"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              disabled={submitting}
              placeholder=""
            />
          </div>
        </div>

        {/* Image URL */}
        <div>
          <label
            htmlFor="imageUrl"
            className="block text-sm font-body font-semibold text-foreground mb-2"
          >
            Image URL
          </label>
          <Input
            id="imageUrl"
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            disabled={submitting}
            placeholder="https://…"
          />
          <p className="text-xs text-muted-foreground font-body mt-1.5">
            Paste any public image URL for now. Storage uploads coming.
          </p>
        </div>

        {/* Kind-specific fields */}
        {kind === 'physical' && (
          <div>
            <label
              htmlFor="weight"
              className="block text-sm font-body font-semibold text-foreground mb-2"
            >
              Weight (grams){' '}
              <span className="text-muted-foreground font-normal">
                (optional, for shipping)
              </span>
            </label>
            <Input
              id="weight"
              type="number"
              min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              disabled={submitting}
            />
          </div>
        )}

        {kind === 'digital' && (
          <div>
            <label
              htmlFor="deliveryUrl"
              className="block text-sm font-body font-semibold text-foreground mb-2"
            >
              Download URL{' '}
              <span className="text-muted-foreground font-normal">
                (emailed to buyer)
              </span>
            </label>
            <Input
              id="deliveryUrl"
              type="url"
              value={deliveryUrl}
              onChange={(e) => setDeliveryUrl(e.target.value)}
              disabled={submitting}
              placeholder="https://…"
            />
          </div>
        )}

        {kind === 'nft' && (
          <div>
            <label className="block text-sm font-body font-semibold text-foreground mb-2">
              Blockchain
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['polygon', 'ethereum', 'base'] as const).map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setBlockchain(c)}
                  className={cn(
                    'rounded-lg border px-4 py-2 text-sm font-body font-semibold capitalize transition-colors',
                    blockchain === c
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground font-body mt-2">
              Token metadata + on-chain mint will be wired up in a later pass.
              For now, NFT sales deliver a digital certificate via email.
            </p>
          </div>
        )}

        {/* Publish toggle */}
        <div className="flex items-center gap-3 pt-2">
          <input
            id="publishNow"
            type="checkbox"
            checked={publishNow}
            onChange={(e) => setPublishNow(e.target.checked)}
            disabled={submitting}
            className="w-4 h-4 rounded border-border"
          />
          <label
            htmlFor="publishNow"
            className="text-sm font-body text-foreground cursor-pointer"
          >
            Publish immediately
          </label>
        </div>

        <Button type="submit" size="lg" disabled={submitting} className="w-full">
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            'Save product'
          )}
        </Button>
      </form>
    </div>
  )
}

// ============================================================
// Product tile (state 4 list)
// ============================================================
function ProductTile({ product }: { product: Product }) {
  const statusVariant =
    product.status === 'published'
      ? 'default'
      : product.status === 'draft'
        ? 'outline'
        : 'secondary'

  return (
    <Link
      href={product.status === 'published' ? `/gallery/${product.slug}` : '#'}
      className={cn(
        'group rounded-xl border border-border bg-card overflow-hidden transition-colors',
        product.status === 'published' && 'hover:border-primary/40'
      )}
    >
      {product.primary_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.primary_image_url}
          alt={product.title}
          className="w-full aspect-square object-cover"
        />
      ) : (
        <div className="w-full aspect-square bg-muted flex items-center justify-center">
          <Package className="w-8 h-8 text-muted-foreground" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-heading font-bold text-foreground line-clamp-1">
            {product.title}
          </h3>
          <Badge variant={statusVariant} className="shrink-0 text-[10px]">
            {product.status}
          </Badge>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="font-body text-lg text-primary font-semibold">
            ${(product.price_cents / 100).toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground font-body uppercase tracking-widest">
            {product.kind}
          </span>
        </div>
      </div>
    </Link>
  )
}
