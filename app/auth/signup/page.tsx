'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuthCard } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * /auth/signup — email + password account creation.
 *
 * Behavior preserved from the pre-restyle version:
 *
 *  - Supabase client deferred to post-mount (SSR-safe)
 *  - Password confirmation match enforced client-side
 *  - On success, shows a confirmation banner then redirects to
 *    /auth/signin after 1.2s
 *
 * Known UX gap left for later: this page does NOT preserve the
 * `redirect` query param on sign-up the way /auth/signin does. So
 * if a visitor bounces through signup from /membership?intent=vip,
 * they end up at /auth/signin and have to re-authenticate before
 * the intent resumes. Works, but clunky. Fix in a separate turn —
 * not a restyle concern.
 */

export default function SignUpPage() {
  const router = useRouter()

  const [mounted, setMounted] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const supabase = useMemo(() => {
    if (!mounted) return null
    try {
      return createClient()
    } catch (err) {
      console.error(err)
      return null
    }
  }, [mounted])

  async function handleSignUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (!supabase) {
      setError(
        'Supabase is not configured for this deployment yet. Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy.'
      )
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      setLoading(false)
      return
    }

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }

      setMessage(
        'Account created. Check your email for a confirmation link if email verification is enabled.'
      )

      setTimeout(() => {
        router.push('/auth/signin')
      }, 1200)
    } catch (err: any) {
      setError(err?.message || 'Sign-up failed.')
    }

    setLoading(false)
  }

  // Don't render the form until hydrated — avoids the flash of
  // disabled-state fields.
  if (!mounted) return null

  return (
    <AuthCard
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/auth/signin"
            className="text-primary hover:underline font-body font-semibold"
          >
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-foreground font-body">{error}</p>
          </div>
        </div>
      )}

      {message && (
        <div className="mb-6 rounded-md border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-foreground font-body">{message}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSignUp} className="space-y-5">
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
          <label
            htmlFor="password"
            className="block text-sm font-body font-semibold text-foreground mb-2"
          >
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder="Create a password"
            disabled={loading}
          />
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-body font-semibold text-foreground mb-2"
          >
            Confirm password
          </label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder="Re-enter the password"
            disabled={loading}
          />
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={loading || !supabase}
        >
          {loading ? 'Creating account…' : 'Sign up free'}
        </Button>

        <p className="text-xs text-muted-foreground font-body text-center pt-2">
          By signing up you agree to our{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthCard>
  )
}
