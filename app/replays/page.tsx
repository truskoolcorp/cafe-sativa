import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { vipReplayAllowed } from '@/lib/content/vip-replay-access'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'VIP Replay Vault — Café Sativa' }

/** Secure empty-state foundation. Do NOT expose video URLs or query
 * public venue media for VIP recordings: that endpoint is public.
 * Replays require their own canonical job, approved rights and private
 * delivery endpoint before the catalog can be populated.
 */
export default async function ReplayVault() {
 const db = createClient()
 const { data: auth, error: authError } = await db.auth.getUser()
 if (authError || !auth.user) redirect('/auth/signin?redirect=/replays')
 const { data: member, error } = await db.from('members_v')
   .select('tier,status,current_period_end')
   .eq('id',auth.user.id).maybeSingle()
 // A missing or ambiguous membership record must never imply VIP access.
 const eligible = !error && vipReplayAllowed(member)
 return <main className="max-w-5xl mx-auto px-4 py-16">
  <p className="text-xs tracking-widest uppercase text-primary font-semibold">Member experiences</p>
  <h1 className="font-heading text-4xl font-bold mt-3">VIP Replay Vault</h1>
  <p className="mt-4 text-muted-foreground max-w-2xl">Approved event recordings will become available here after canonical media verification, editorial approval and rights checks. No unreleased video is exposed.</p>
  {!eligible ? <section className="mt-10 rounded-xl border border-border bg-card p-6">
   <h2 className="font-heading text-2xl">VIP access required</h2>
   <p className="mt-3 text-muted-foreground">Replay access requires an active VIP membership. Membership data must be verified before any content can be streamed.</p>
   <Link href="/membership" className="mt-5 inline-flex text-primary underline underline-offset-4">View membership options</Link>
  </section> : <section className="mt-10 rounded-xl border border-border bg-card p-6">
   <h2 className="font-heading text-2xl">Recordings coming soon</h2>
   <p className="mt-3 text-muted-foreground">Your membership is eligible for future VIP replays. There are no independently approved replay releases to display yet.</p>
  </section>}
  <Link href="/account" className="mt-8 inline-flex text-primary underline underline-offset-4">Return to your dashboard</Link>
 </main>
}
