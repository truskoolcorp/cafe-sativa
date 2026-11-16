import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/artists/sync
 *
 * Called by the artist dashboard when the artist returns from Stripe
 * onboarding (?onboarding=complete) or clicks a manual "refresh"
 * button. Retrieves the current Connect account state from Stripe
 * and mirrors payouts_enabled / charges_enabled / onboarding_state
 * into our artists row, plus flips is_approved on when both
 * capabilities are active.
 *
 * This is belt-and-suspenders alongside the account.updated webhook
 * (which also syncs): webhooks can be delayed or drop, and the
 * artist is standing right there hitting refresh expecting the
 * "Start selling" button to turn on.
 */

export async function POST(req: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: 'Stripe is not configured.' },
      { status: 503 }
    )
  }

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  )

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    return NextResponse.json(
      { error: 'Not signed in.', code: 'not_authenticated' },
      { status: 401 }
    )
  }

  const admin = createAdminClient()
  const stripe = new Stripe(stripeSecretKey)

  const { data: artist } = await admin
    .from('artists')
    .select('id, stripe_account_id')
    .eq('user_id', authData.user.id)
    .maybeSingle()

  if (!artist || !artist.stripe_account_id) {
    return NextResponse.json(
      { error: 'No artist profile or Connect account.', code: 'no_artist' },
      { status: 404 }
    )
  }

  try {
    const account = await stripe.accounts.retrieve(artist.stripe_account_id)

    const payoutsEnabled = account.payouts_enabled ?? false
    const chargesEnabled = account.charges_enabled ?? false
    const detailsSubmitted = account.details_submitted ?? false

    // State machine:
    //   - both enabled + details submitted → 'active'
    //   - details submitted but not enabled → 'rejected' (Stripe declined)
    //   - nothing submitted yet → 'pending'
    let onboardingState: 'pending' | 'active' | 'rejected' = 'pending'
    if (payoutsEnabled && chargesEnabled) {
      onboardingState = 'active'
    } else if (detailsSubmitted && !payoutsEnabled) {
      onboardingState = 'rejected'
    }

    const isApproved = onboardingState === 'active'

    await admin
      .from('artists')
      .update({
        payouts_enabled: payoutsEnabled,
        charges_enabled: chargesEnabled,
        onboarding_state: onboardingState,
        is_approved: isApproved,
      })
      .eq('id', artist.id)

    return NextResponse.json({
      onboarding_state: onboardingState,
      payouts_enabled: payoutsEnabled,
      charges_enabled: chargesEnabled,
      details_submitted: detailsSubmitted,
      is_approved: isApproved,
    })
  } catch (err: any) {
    console.error('[artists/sync] retrieve failed', err)
    return NextResponse.json(
      { error: 'Could not sync with Stripe.' },
      { status: 500 }
    )
  }
}
