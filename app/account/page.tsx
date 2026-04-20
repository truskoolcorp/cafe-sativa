'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type MembershipState = {
  tier: 'explorer' | 'regular' | 'vip'
  status: 'active' | 'canceled' | 'past_due' | 'incomplete'
  currentPeriodEnd: string | null
  isStaff: boolean
  isAdmin: boolean
  displayName: string | null
}

export default function AccountPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [membership, setMembership] = useState<MembershipState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadUser() {
      try {
        const supabase = createClient()
        const { data, error: userError } = await supabase.auth.getUser()

        if (userError || !data.user) {
          router.push('/auth/signin?redirect=/account')
          return
        }

        setEmail(data.user.email ?? null)

        // Fetch member row from the view
        const { data: memberRow, error: memberError } = await supabase
          .from('members_v')
          .select('tier, status, current_period_end, is_staff, is_admin, display_name')
          .eq('id', data.user.id)
          .maybeSingle()

        if (memberError) {
          // View exists, but the row might not — fall back to defaults.
          console.warn('members_v read failed:', memberError)
        }

        if (memberRow) {
          setMembership({
            tier: memberRow.tier,
            status: memberRow.status,
            currentPeriodEnd: memberRow.current_period_end,
            isStaff: memberRow.is_staff,
            isAdmin: memberRow.is_admin,
            displayName: memberRow.display_name,
          })
        } else {
          // Profile row hasn't been created yet (trigger not fired, or race).
          // Default to explorer until the row shows up.
          setMembership({
            tier: 'explorer',
            status: 'active',
            currentPeriodEnd: null,
            isStaff: false,
            isAdmin: false,
            displayName: null,
          })
        }
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

  const tierLabel =
    membership?.tier === 'vip'
      ? 'VIP'
      : membership?.tier === 'regular'
        ? 'Regular'
        : 'Explorer'

  const statusLabel =
    membership?.status === 'past_due'
      ? 'Payment past due'
      : membership?.status === 'canceled'
        ? 'Canceled (access remains through the period end)'
        : membership?.status === 'incomplete'
          ? 'Incomplete (payment pending)'
          : 'Active'

  const renewalDate = membership?.currentPeriodEnd
    ? new Date(membership.currentPeriodEnd).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  const tierDescription =
    membership?.tier === 'vip'
      ? "Cigar Lounge, 20% off merch, priority ticketing, Tenerife priority list, and 365 days of host memory."
      : membership?.tier === 'regular'
        ? 'All events free, 10% off merch, event recordings, and 90 days of host memory.'
        : 'Venue access, Laviche chat, event browsing. Upgrade for free tickets and more.'

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
          <p className="text-sm uppercase tracking-[0.35em] text-[#c9a961]">Account</p>

          <h1 className="mt-4 text-4xl font-semibold text-[#c9a961]">
            {membership?.displayName
              ? `Welcome back, ${membership.displayName}.`
              : 'Welcome to Café Sativa'}
          </h1>

          {loading && <p className="mt-6 text-[#f5e6d3]/80">Loading account...</p>}
          {error && <p className="mt-6 text-red-300">{error}</p>}

          {!loading && !error && membership && (
            <div className="mt-8 space-y-4">
              <div className="rounded-xl border border-[#c9a961]/20 bg-[#2b1810]/60 p-5">
                <p className="text-sm text-[#f5e6d3]/60">Signed in as</p>
                <p className="mt-2 text-lg font-medium">{email || 'Unknown user'}</p>
                {(membership.isStaff || membership.isAdmin) && (
                  <p className="mt-2 text-xs uppercase tracking-[0.25em] text-[#c9a961]/80">
                    {membership.isAdmin ? 'Admin' : 'Staff'} access enabled
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[#c9a961]/20 bg-[#2b1810]/60 p-5">
                <div className="flex flex-wrap items-baseline gap-3">
                  <p className="text-sm text-[#f5e6d3]/60">Membership tier</p>
                  <p className="text-2xl font-semibold text-[#c9a961]">{tierLabel}</p>
                </div>
                <p className="mt-2 text-sm text-[#f5e6d3]/80">{tierDescription}</p>

                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <span className="text-[#f5e6d3]/60">
                    Status: <span className="text-[#f5e6d3]">{statusLabel}</span>
                  </span>
                  {renewalDate && (
                    <span className="text-[#f5e6d3]/60">
                      {membership.status === 'canceled' ? 'Access through: ' : 'Renews: '}
                      <span className="text-[#f5e6d3]">{renewalDate}</span>
                    </span>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {membership.tier === 'explorer' && (
                    <Link
                      href="/membership"
                      className="rounded-md bg-[#c9a961] px-4 py-2 text-sm font-medium text-[#2b1810] hover:bg-[#e2c27a]"
                    >
                      Upgrade
                    </Link>
                  )}
                  {membership.tier === 'regular' && (
                    <Link
                      href="/membership"
                      className="rounded-md bg-[#c9a961] px-4 py-2 text-sm font-medium text-[#2b1810] hover:bg-[#e2c27a]"
                    >
                      Upgrade to VIP
                    </Link>
                  )}
                  {membership.tier !== 'explorer' && (
                    <Link
                      href="/membership"
                      className="rounded-md border border-[#c9a961]/25 px-4 py-2 text-sm hover:bg-white/5"
                    >
                      Manage subscription
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
