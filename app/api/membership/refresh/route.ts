import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cafeSubscriptionTier } from '@/lib/membership-prices'

export const dynamic = 'force-dynamic'
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Invalid origin.' }, 403)
  try {
    const { data: auth, error: authError } = await createClient().auth.getUser()
    if (authError || !auth.user) return reply({ error: 'Sign in to refresh membership.' }, 401)
    const admin = createAdminClient()
    const { data: member, error } = await admin.from('memberships')
      .select('stripe_customer_id,stripe_subscription_id').eq('user_id', auth.user.id).maybeSingle()
    if (error) return reply({ error: 'Could not read membership. Please retry.' }, 503)
    if (!member?.stripe_customer_id || !member.stripe_subscription_id) return reply({ error: 'No Stripe subscription is linked yet. Payment confirmation may still be pending.' }, 409)
    if (!process.env.STRIPE_SECRET_KEY) return reply({ error: 'Membership refresh is unavailable.' }, 503)
    const sub = await new Stripe(process.env.STRIPE_SECRET_KEY).subscriptions.retrieve(member.stripe_subscription_id)
    const tier = cafeSubscriptionTier(sub)
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    if (!tier || sub.metadata.user_id !== auth.user.id || customer !== member.stripe_customer_id) {
      return reply({ error: 'Your billing link needs support verification.' }, 409)
    }
    const end = sub.items.data[0].current_period_end ?? (sub as unknown as {current_period_end?: number}).current_period_end
    const currentPeriodEnd = typeof end === 'number' && Number.isFinite(end) && end > 0 ? new Date(end * 1000).toISOString() : null
    const status = ['active','trialing'].includes(sub.status) ? 'active' : ['past_due','unpaid'].includes(sub.status) ? 'past_due' : ['canceled','incomplete_expired'].includes(sub.status) ? 'canceled' : 'incomplete'
    // Update only the exact subscription observed; a concurrent replacement must not be overwritten.
    const { data: updated, error: writeError } = await admin.from('memberships').update({tier,status,current_period_end:currentPeriodEnd})
      .eq('user_id', auth.user.id).eq('stripe_subscription_id', sub.id).select('user_id').maybeSingle()
    if (writeError || !updated) return reply({ error: 'Membership changed during refresh. Please retry.' }, 503)
    return reply({ tier, status, currentPeriodEnd, cancelAtPeriodEnd: sub.cancel_at_period_end })
  } catch {
    return reply({ error: 'Could not refresh membership. Please retry or contact support.' }, 503)
  }
}
