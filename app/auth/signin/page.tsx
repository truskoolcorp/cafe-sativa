'use client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignInPage() {
  const [mounted, setMounted] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useRouter()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const supabase = createClient()

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
    } else {
      router.push('/')
      router.refresh()
    }

    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-[#2B1810] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[#5C4033] rounded-lg p-8 border border-[#C9A961]">
        <div className="text-center mb-8">
          <span className="text-4xl">☕</span>
          <h1 className="text-[#C9A961] text-3xl font-serif mt-4">
            Sign in to Café Sativa
          </h1>
        </div>

        {error && (
          <div className="bg-red-900 text-white p-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-6">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-white rounded"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-white rounded"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#C9A961] text-[#2B1810] py-3 rounded font-semibold"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center mt-6 text-sm text-[#F5E6D3]">
          Don’t have an account?{' '}
          <Link href="/auth/signup" className="text-[#C9A961]">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  )
}
