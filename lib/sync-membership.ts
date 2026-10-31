import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { cafeSubscriptionTier } from '@/lib/membership-prices'

type Tier = 'regular' | 'vip'
const customerId = (sub: Stripe.Subscription) => typeof sub.customer === 'string' ? sub.customer : sub.customer.id

// Read the local revision BEFORE retrieving Stripe state. Every write compares that
// revision, so a concurrent replacement or cancellation forces a fresh retry.
export async function syncCafeMembership(admin: ReturnType<typeof createAdminClient>, stripe: Stripe, input: {
  userId: string; subscriptionId: string; mode: 'checkout' | 'subscription';
  expectedCustomer?: string | null; expectedTier?: Tier;
}) {
  const {data: member,error: readError} = await admin.from('memberships')
    .select('stripe_customer_id,stripe_subscription_id,updated_at').eq('user_id',input.userId).maybeSingle()
  if (readError) throw new Error('Membership lookup failed')
  if (input.mode === 'subscription' && member?.stripe_subscription_id !== input.subscriptionId) return 'ignored'

  const sub = await stripe.subscriptions.retrieve(input.subscriptionId)
  const tier = cafeSubscriptionTier(sub)
  const customer = customerId(sub)
  const legacyLinked = input.mode === 'subscription' && !sub.metadata?.user_id &&
    member?.stripe_subscription_id === sub.id && member?.stripe_customer_id === customer
  if (sub.id !== input.subscriptionId || !tier || (!legacyLinked && sub.metadata?.user_id !== input.userId) ||
      (input.expectedTier && tier !== input.expectedTier) ||
      (input.expectedCustomer && customer !== input.expectedCustomer) ||
      (input.mode === 'subscription' && member?.stripe_customer_id !== customer)) return 'ignored'

  if (member?.stripe_subscription_id && member.stripe_subscription_id !== sub.id) {
    // Only a verified checkout may replace the established subscription. A late
    // checkout for an older subscription cannot overwrite a newer subscription.
    const previous = await stripe.subscriptions.retrieve(member.stripe_subscription_id)
    if (previous.id !== member.stripe_subscription_id || !cafeSubscriptionTier(previous) ||
        (previous.metadata?.user_id && previous.metadata.user_id !== input.userId) ||
        customerId(previous) !== member.stripe_customer_id) throw new Error('Existing billing link needs reconciliation')
    if (!Number.isSafeInteger(sub.created) || sub.created <= 0 || !Number.isSafeInteger(previous.created) || previous.created <= 0 || sub.created === previous.created) throw new Error('Subscription order needs reconciliation')
    if (sub.created < previous.created) return 'ignored'
  }

  const end = sub.items?.data?.[0]?.current_period_end ?? (sub as unknown as {current_period_end?: number}).current_period_end
  const status = ['active','trialing'].includes(sub.status) ? 'active' : ['past_due','unpaid'].includes(sub.status) ? 'past_due' : ['canceled','incomplete_expired'].includes(sub.status) ? 'canceled' : 'incomplete'
  const date = typeof end === 'number' && Number.isSafeInteger(end) && end > 0 ? new Date(end * 1000) : null
  const currentPeriodEnd = date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
  if (status === 'active' && !currentPeriodEnd) throw new Error('Subscription period unavailable')
  const values = {user_id:input.userId,tier,status,stripe_customer_id:customer,stripe_subscription_id:sub.id,current_period_end:currentPeriodEnd}
  if (!member) {
    // Concurrent first checkouts must never overwrite each other via upsert.
    const {data: inserted,error} = await admin.from('memberships')
      .upsert(values,{onConflict:'user_id',ignoreDuplicates:true}).select('user_id').maybeSingle()
    if (error || !inserted) throw new Error('Membership changed; retry required')
  } else {
    if (!member.updated_at) throw new Error('Membership revision unavailable')
    let query = admin.from('memberships').update(values).eq('user_id',input.userId).eq('updated_at',member.updated_at)
    query = member.stripe_subscription_id ? query.eq('stripe_subscription_id',member.stripe_subscription_id) : query.is('stripe_subscription_id',null)
    const {data: updated,error} = await query.select('user_id').maybeSingle()
    if (error || !updated) throw new Error('Membership changed; retry required')
  }
  return 'applied'
}
