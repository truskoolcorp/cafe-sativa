'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
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

  if (!mounted) return null

  return (
    <main className="min-h-screen bg-[#2B1810] flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full bg-[#5C4033] rounded-lg p-8 border border-[#C9A961]">
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          <Link href="/" className="text-[#F5E6D3] hover:underline">
            ← Home
          </Link>
          <span className="text-[#c9a961]/50">•</span>
          <Link href="/membership" className="text-[#F5E6D3] hover:underline">
            Membership
          </Link>
          <span className="text-[#c9a961]/50">•</span>
          <Link href="/auth/signin" className="text-[#C9A961] hover:underline">
            Sign In
          </Link>
        </div>

        <div className="text-center mb-8">
          <span className="text-4xl">☕</span>
          <h1 className="text-[#C9A961] text-3xl font-serif mt-4">
            Create your Café Sativa account
          </h1>
        </div>

        {error && (
          <div className="bg-red-900 text-white p-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        {message && (
          <div className="bg-green-900 text-white p-3 rounded mb-6 text-sm">
            {message}
          </div>
        )}

        <form onSubmit={handleSignUp} className="space-y-6">
          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="you@email.com"
            />
          </div>

          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="Create password"
            />
          </div>

          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="Confirm password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !supabase}
            className="w-full bg-[#C9A961] text-[#2B1810] py-4 rounded font-semibold hover:bg-[#F5E6D3] transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-[#F5E6D3] text-sm">
            Already have an account?{' '}
            <Link href="/auth/signin" className="text-[#C9A961] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
