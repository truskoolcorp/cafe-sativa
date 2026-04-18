'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthNav() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadSession() {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()

        if (!mounted) return
        setEmail(data.user?.email ?? null)

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          setEmail(session?.user?.email ?? null)
          router.refresh()
        })

        return () => subscription.unsubscribe()
      } catch {
        if (mounted) setEmail(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    const cleanupPromise = loadSession()

    return () => {
      mounted = false
      Promise.resolve(cleanupPromise).then((cleanup) => {
        if (typeof cleanup === 'function') cleanup()
      })
    }
  }, [router])

  async function handleSignOut() {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/')
      router.refresh()
    } catch (err) {
      console.error('Sign out failed:', err)
    }
  }

  if (loading) {
    return (
      <nav className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/" className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5">
          Home
        </Link>
        <Link href="/membership" className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5">
          Membership
        </Link>
      </nav>
    )
  }

  return (
    <nav className="flex flex-wrap items-center gap-3 text-sm">
      <Link href="/" className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5">
        Home
      </Link>

      <Link href="/membership" className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5">
        Membership
      </Link>

      {email ? (
        <>
          <Link
            href="/account"
            className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5"
          >
            Account
          </Link>
          <button
            onClick={handleSignOut}
            className="rounded-md bg-[#c9a961] px-4 py-2 font-medium text-[#2b1810] transition hover:bg-[#e2c27a]"
          >
            Sign Out
          </button>
        </>
      ) : (
        <>
          <Link
            href="/auth/signin"
            className="rounded-md px-3 py-2 text-[#f5e6d3] transition hover:bg-white/5"
          >
            Sign In
          </Link>
          <Link
            href="/auth/signup"
            className="rounded-md bg-[#c9a961] px-4 py-2 font-medium text-[#2b1810] transition hover:bg-[#e2c27a]"
          >
            Sign Up
          </Link>
        </>
      )}
    </nav>
  )
}
