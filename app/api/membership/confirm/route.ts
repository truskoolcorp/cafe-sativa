import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncCafeMembership } from '@/lib/sync-membership'

export const dynamic = 'force-dynamic'
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store' },
})

// A redirect is not payment evidence. Recover a delayed initial webhook only
// after Stripe verifies this signed-in user's completed membership checkout.
export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Invalid origin.' }, 403)
  try {
    const { data: auth, error } = await createClient().auth.getUser()
    if (error || !auth.user) return reply({ error: 'Sign in with the account used for checkout.' }, 401)
    const body = await req.json().catch(() => null)
    const sessionId = body?.sessionId
    if (typeof sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]{1,250}$/.test(sessionId)) {
      return reply({ error: 'Invalid checkout reference.' }, 400)
    }
    if (!process.env.STRIPE_SECRET_KEY) return reply({ error: 'Membership confirmation is temporarily unavailable.' }, 503)
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const tier = session.metadata?.tier
    const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id
    const subscription = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
    if (session.id !== sessionId || session.metadata?.site !== 'cafe-sativa' ||
        session.metadata?.user_id !== auth.user.id || session.mode !== 'subscription' ||
        (tier !== 'regular' && tier !== 'vip') || !customer || !subscription) {
      return reply({ error: 'This checkout cannot be confirmed for your account.' }, 409)
    }
    if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) {
      return reply({ error: 'Payment confirmation is still pending. Please retry shortly.' }, 409)
    }
    // Re-read current subscription state and use the existing catalog, ownership,
    // period and compare-and-swap checks. Never activate from the redirect alone.
    const result = await syncCafeMembership(createAdminClient(), stripe, {
      userId: auth.user.id, subscriptionId: subscription, mode: 'checkout',
      expectedCustomer: customer, expectedTier: tier,
    })
    if (result !== 'applied') return reply({ error: 'This checkout no longer matches your membership. Check your account or contact support.' }, 409)
    return reply({ synchronized: true })
  } catch {
    return reply({ error: 'Could not confirm membership. Please retry or contact support.' }, 503)
  }
}
