import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
const PORTAL_CONFIGURATION = 'bpc_1UPOC2IDc7LlvDW9P3m45ZQR'
const PRICES = new Set(['price_1TNFwCIDc7LlvDW9siOcRvdd', 'price_1TNFx1IDc7LlvDW9KZvLsnsl'])
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Invalid origin.' }, 403)
  try {
    const { data: auth, error: authError } = await createClient().auth.getUser()
    if (authError || !auth.user) return reply({ error: 'Sign in to manage your membership.' }, 401)
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) return reply({ error: 'Membership billing is temporarily unavailable.' }, 503)
    const { data: member, error } = await createAdminClient().from('memberships')
      .select('stripe_customer_id, stripe_subscription_id').eq('user_id', auth.user.id).maybeSingle()
    if (error) return reply({ error: 'Could not verify your membership. Please retry.' }, 503)
    if (!member?.stripe_customer_id || !member.stripe_subscription_id) {
      return reply({ error: 'No paid subscription is linked to your account.' }, 409)
    }
    const stripe = new Stripe(key)
    const sub = await stripe.subscriptions.retrieve(member.stripe_subscription_id)
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    const ownSubscription = (entry: Stripe.Subscription) => entry.metadata.user_id === auth.user.id &&
      entry.items.data.length === 1 && PRICES.has(entry.items.data[0].price.id)
    if (customer !== member.stripe_customer_id || !ownSubscription(sub)) {
      return reply({ error: 'Your billing link needs support verification.' }, 409)
    }
    // Stripe's portal exposes the customer as a whole. Block shared customer records
    // that could expose subscriptions belonging to another project.
    const subscriptions = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 })
    if (subscriptions.has_more || !subscriptions.data.length || subscriptions.data.some(entry => !ownSubscription(entry))) {
      return reply({ error: 'Your billing link needs support verification.' }, 409)
    }
    const session = await stripe.billingPortal.sessions.create({
      customer, configuration: PORTAL_CONFIGURATION,
      return_url: 'https://www.cafe-sativa.com/account',
    })
    if (!session.url || new URL(session.url).origin !== 'https://billing.stripe.com') throw new Error('Invalid portal URL')
    return reply({ url: session.url })
  } catch {
    return reply({ error: 'Could not open membership billing. Please retry or contact support.' }, 503)
  }
}
