import { notFound } from 'next/navigation'
import Link from 'next/link'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export default async function TicketOperations(){
 if(!await isContentAdmin())notFound()
 const result=await createAdminClient().from('cs_ticket_reservations').select('id,event_id,user_id,state,attention_reason,stripe_session_id,stripe_payment_intent_id,amount_cents,created_at').eq('state','payment_attention').order('created_at',{ascending:false}).limit(100)
 return <main className="max-w-5xl mx-auto px-6 pt-24 pb-16"><Link href="/admin" className="underline">← Back to dashboard</Link><h1 className="text-3xl font-bold mt-6">Ticket payment reconciliation</h1><p className="mt-4">Payments listed here did not grant admission. Review the receipt and ticket history before deciding on fulfillment or a refund. Refunds are not automatic.</p>{result.error?<p className="mt-6">Payment exceptions could not be loaded. Try again later.</p>:!result.data?.length?<p className="mt-6">No ticket payments currently need reconciliation.</p>:result.data.map(row=><article key={row.id} className="border rounded-xl p-5 mt-6"><h2 className="font-bold">${(row.amount_cents/100).toFixed(2)} · payment needs attention</h2><p>{row.attention_reason}</p><dl className="mt-3 text-sm"><dt>Reservation</dt><dd>{row.id}</dd><dt>Event</dt><dd>{row.event_id}</dd><dt>Customer</dt><dd>{row.user_id}</dd><dt>Stripe checkout</dt><dd>{row.stripe_session_id}</dd><dt>Payment intent</dt><dd>{row.stripe_payment_intent_id}</dd></dl></article>)}</main>
}
