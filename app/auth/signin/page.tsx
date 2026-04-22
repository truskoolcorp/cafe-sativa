'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuthCard } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * /auth/signin — email + password sign-in.
 *
 * Critical to preserve: the ?redirect=... query param handling.
 * /membership and /events/[slug] bounce unauthenticated visitors
 * here with `?redirect=/membership?intent=vip` (or equivalent), and
 * expect us to land them back exactly where they were after a
 * successful sign-in. Break that and the entire paid funnel breaks.
 *
 * Suspense wrapper is also non-negotiable — Next 14 requires it
 * around any component reading useSearchParams() or the static
 * prerender bails. This was the fix that finally landed (commit
 * 1c66333) after a ChatGPT patch kept missing it.
 */

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [mounted, setMounted] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Defer Supabase client creation until after hydration so the env
  // var reads don't hit the SSR path. Matches the existing pattern.
  const supabase = useMemo(() => {
    if (!mounted) return null
    try {
      return createClient()
    } catch (err) {
      console.error(err)
      return null
    }
  }, [mounted])

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (!supabase) {
      setError(
        'Supabase is not configured for this deployment yet. Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy.'
      )
      setLoading(false)
      return
    }

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(signInError.message)
        setLoading(false)
        return
      }

      // Redirect target comes from the upstream page — /membership
      // and /events/[slug] both pass along an `intent` param so the
      // action auto-resumes on return.
      const redirectTo = searchParams.get('redirect') || '/account'
      router.push(redirectTo)
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed.')
    }

    setLoading(false)
  }

  if (!mounted) return <SignInSkeleton />

  return (
    <>
      {error && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-foreground font-body">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSignIn} className="space-y-5">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-body font-semibold text-foreground mb-2"
          >
            Email address
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@email.com"
            disabled={loading}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="password"
              className="block text-sm font-body font-semibold text-foreground"
            >
              Password
            </label>
            {/* Placeholder link for a future /auth/reset flow. We
                leave the link off the DOM for now rather than ship
                a dead click. */}
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            disabled={loading}
          />
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={loading || !supabase}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </>
  )
}

/**
 * Skeleton used as both the pre-mount placeholder and the Suspense
 * fallback. Matches the real form shell so there's no layout jump
 * on hydration.
 */
function SignInSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-5 w-28 bg-muted rounded" />
      <div className="h-10 bg-muted rounded" />
      <div className="h-5 w-20 bg-muted rounded" />
      <div className="h-10 bg-muted rounded" />
      <div className="h-11 bg-primary/30 rounded mt-6" />
    </div>
  )
}

export default function SignInPage() {
  return (
    <AuthCard
      title="Welcome back"
      footer={
        <>
          Don&rsquo;t have an account?{' '}
          <Link
            href="/auth/signup"
            className="text-primary hover:underline font-body font-semibold"
          >
            Sign up free
          </Link>
        </>
      }
    >
      <Suspense fallback={<SignInSkeleton />}>
        <SignInForm />
      </Suspense>
    </AuthCard>
  )
}
