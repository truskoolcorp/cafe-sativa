'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AccountPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadUser() {
      try {
        const supabase = createClient()
        const { data, error } = await supabase.auth.getUser()

        if (error || !data.user) {
          router.push('/auth/signin?redirect=/account')
          return
        }

        setEmail(data.user.email ?? null)
      } catch (err: any) {
        setError(err?.message || 'Failed to load account.')
      } finally {
        setLoading(false)
      }
    }

    loadUser()
  }, [router])

  async function handleSignOut() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/')
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Sign out failed.')
    }
  }

  return (
    <main className="min-h-screen bg-[#1a0904] px-6 py-20 text-[#f5e6d3] lg:px-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Link href="/" className="rounded-md px-4 py-2 text-[#f5e6d3] hover:bg-white/5">
            ← Back Home
          </Link>
          <Link
            href="/membership"
            className="rounded-md border border-[#c9a961]/25 px-4 py-2 text-[#f5e6d3] hover:bg-white/5"
          >
            Membership
          </Link>
          <button
            onClick={handleSignOut}
            className="rounded-md bg-[#c9a961] px-4 py-2 font-medium text-[#2b1810] hover:bg-[#e2c27a]"
          >
            Sign Out
          </button>
        </div>

        <div className="rounded-2xl border border-[#c9a961]/20 bg-black/20 p-8">
          <p className="text-sm uppercase tracking-[0.35em] text-[#c9a961]">
            Account
          </p>

          <h1 className="mt-4 text-4xl font-semibold text-[#c9a961]">
            Welcome to Café Sativa
          </h1>

          {loading && <p className="mt-6 text-[#f5e6d3]/80">Loading account...</p>}
          {error && <p className="mt-6 text-red-300">{error}</p>}

          {!loading && !error && (
            <div className="mt-8 space-y-4">
              <div className="rounded-xl border border-[#c9a961]/20 bg-[#2b1810]/60 p-5">
                <p className="text-sm text-[#f5e6d3]/60">Signed in as</p>
                <p className="mt-2 text-lg font-medium">{email || 'Unknown user'}</p>
              </div>

              <div className="rounded-xl border border-[#c9a961]/20 bg-[#2b1810]/60 p-5">
                <p className="text-sm text-[#f5e6d3]/60">Membership status</p>
                <p className="mt-2 text-lg font-medium">Not yet linked</p>
                <p className="mt-2 text-sm text-[#f5e6d3]/70">
                  Next step: wire Stripe + Supabase membership sync for premium access.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
