'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
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
      router.push('/')        // go back to homepage after login
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-[#2B1810] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[#5C4033] rounded-lg p-8 border border-[#C9A961]">
        <div className="text-center mb-8">
          <span className="text-4xl">☕</span>
          <h1 className="text-[#C9A961] text-3xl font-serif mt-4">Sign in to Café Sativa</h1>
        </div>

        {error && (
          <div className="bg-red-900 text-white p-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-6">
          <div>
            <label className="block text-[#F5E6D3] text-sm mb-2">Email address</label>
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
            <label className="block text-[#F5E6D3] text-sm mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[#2B1810] border border-[#C9A961] text-[#F5E6D3] rounded focus:outline-none focus:ring-2 focus:ring-[#C9A961]"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#C9A961] text-[#2B1810] py-4 rounded font-semibold hover:bg-[#F5E6D3] transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-[#F5E6D3] text-sm">
            Don’t have an account?{' '}
            <Link href="/auth/signup" className="text-[#C9A961] hover:underline">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
