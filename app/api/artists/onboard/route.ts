import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/artists/onboard
 *
 * Creates (or returns the existing) Stripe Connect Express account for
 * the authenticated user, then returns an Account Link URL the browser
 * should redirect to so the artist can complete onboarding.
 *
 * Flow:
 *   1. Browser POSTs with { display_name } (first time) or empty body
 *      (returning artist resuming onboarding).
 *   2. Server looks up the artists row by user_id.
 *   3. If no row → create row + create Connect Express account +
 *      attach account_id, set onboarding_state='pending'.
 *   4. If row exists without stripe_account_id → create account now.
 *   5. If row exists with stripe_account_id → skip creation.
 *   6. Generate a fresh Account Link (these expire in ~15 min).
 *   7. Return { url } — client navigates the top-level window.
 *
 * After onboarding, Stripe redirects the user back to
 * /artist-dashboard. We verify via the account.updated webhook
 * (Connect events) that onboarding actually completed — the
 * redirect URL alone doesn't prove anything.
 *
 * If Stripe Connect isn't activated on the platform account, the
 * accounts.create call returns an error whose code includes
 * 'platform_account_required'. We surface that to the client so
 * the UI can tell the user "Connect isn't enabled on this Stripe
 * account yet — go to the Stripe dashboard and activate it."
 */

type Body = {
  display_name?: string
  bio?: string
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function POST(req: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: 'Stripe is not configured.', code: 'stripe_not_configured' },
      { status: 503 }
    )
  }

  // Supabase SSR client — reads the auth cookie so we know who's
  // asking without requiring the client to pass their user id.
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

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return NextResponse.json(
      { error: 'Sign in to become an artist.', code: 'not_authenticated' },
      { status: 401 }
    )
  }

  const user = authData.user

  let body: Body = {}
  try {
    body = await req.json()
  } catch {
    // Empty body is fine (returning artist)
  }

  const admin = createAdminClient()
  const stripe = new Stripe(stripeSecretKey)

  // Look up existing artist row
  const { data: existingArtist } = await admin
    .from('artists')
    .select('id, stripe_account_id, onboarding_state, slug, display_name')
    .eq('user_id', user.id)
    .maybeSingle()

  let artistId: string
  let stripeAccountId: string | null = existingArtist?.stripe_account_id ?? null

  if (!existingArtist) {
    // First-time onboarding — need display_name
    const displayName = body.display_name?.trim()
    if (!displayName) {
      return NextResponse.json(
        { error: 'Display name is required.', code: 'missing_display_name' },
        { status: 400 }
      )
    }

    // Generate unique slug. On collision, append a short hash.
    let slug = slugify(displayName)
    if (!slug) slug = 'artist'

    const { data: slugTaken } = await admin
      .from('artists')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (slugTaken) {
      slug = `${slug}-${user.id.slice(0, 6)}`
    }

    const { data: inserted, error: insertError } = await admin
      .from('artists')
      .insert({
        user_id: user.id,
        display_name: displayName,
        slug,
        bio: body.bio ?? null,
        onboarding_state: 'none',
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[artists/onboard] insert failed', insertError)
      return NextResponse.json(
        { error: 'Could not create artist profile.' },
        { status: 500 }
      )
    }
    artistId = inserted.id
  } else {
    artistId = existingArtist.id
  }

  // Create the Stripe Connect Express account if we don't have one yet.
  // Express accounts give us a Stripe-hosted onboarding flow where
  // the artist uploads ID, fills tax info, connects a bank account,
  // etc. — we never handle the sensitive bits.
  if (!stripeAccountId) {
    try {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email ?? undefined,
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        business_type: 'individual',
        metadata: {
          artist_id: artistId,
          user_id: user.id,
        },
      })
      stripeAccountId = account.id

      await admin
        .from('artists')
        .update({
          stripe_account_id: stripeAccountId,
          onboarding_state: 'pending',
        })
        .eq('id', artistId)
    } catch (err: any) {
      // If Connect isn't activated on the platform account, Stripe
      // returns a very specific error. Surface it cleanly so the
      // UI can explain what to do.
      const msg = err?.message || ''
      const isConnectNotEnabled =
        msg.includes('signed up for Connect') ||
        msg.includes('platform_account') ||
        err?.code === 'platform_account_required'

      console.error('[artists/onboard] Connect account creation failed', {
        message: msg,
        code: err?.code,
        type: err?.type,
      })

      if (isConnectNotEnabled) {
        return NextResponse.json(
          {
            error:
              'Stripe Connect is not activated on this platform account. Activate it in the Stripe Dashboard → Connect → Get started.',
            code: 'connect_not_activated',
          },
          { status: 503 }
        )
      }

      return NextResponse.json(
        {
          error: 'Could not create payout account. ' + (msg || 'Try again.'),
          code: 'connect_create_failed',
        },
        { status: 500 }
      )
    }
  }

  // Generate a fresh Account Link. These are single-use and expire
  // quickly; we always mint a new one on each onboarding click.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.cafe-sativa.com'

  try {
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId!,
      refresh_url: `${siteUrl}/artist-dashboard?onboarding=refresh`,
      return_url: `${siteUrl}/artist-dashboard?onboarding=complete`,
      type: 'account_onboarding',
    })

    return NextResponse.json({
      url: accountLink.url,
      artist_id: artistId,
      stripe_account_id: stripeAccountId,
    })
  } catch (err: any) {
    console.error('[artists/onboard] accountLinks.create failed', err)
    return NextResponse.json(
      { error: 'Could not start onboarding. Try again.' },
      { status: 500 }
    )
  }
}
