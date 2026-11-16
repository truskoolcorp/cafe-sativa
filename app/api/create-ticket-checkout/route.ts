import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
 if(req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Request origin not allowed.'},{status:403})
 try {
  const body=await req.json().catch(()=>null),eventId=body?.event_id
  if(typeof eventId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId))return NextResponse.json({error:'Invalid event.'},{status:400})
  const {data:{user},error:authError}=await createClient().auth.getUser()
  if(authError||!user)return NextResponse.json({error:'Please sign in first.',code:'not_authenticated'},{status:401})
  if(!user.email)return NextResponse.json({error:'Your account has no email on file.'},{status:400})
  const db=createAdminClient()
  const {data:quote,error}=await db.rpc('cs_reserve_ticket',{event_uuid:eventId,user_uuid:user.id})
  if(error||!quote)throw Error('Reservation unavailable')
  if(quote.error){const messages:Record<string,string>={not_found:'Event not found.',closed:'Ticket sales for this event are closed.',already_ticketed:'You already have a ticket to this event.',sold_out:'This event is sold out.'};return NextResponse.json({error:messages[quote.error]||'Ticket availability is being confirmed.',code:quote.error},{status:quote.error==='not_found'?404:409})}
  if(quote.granted)return NextResponse.json({granted:true,source:quote.source})
  const key=process.env.STRIPE_SECRET_KEY
  if(!key)return NextResponse.json({error:'Ticket checkout is temporarily unavailable.'},{status:503})
  const stripe=new Stripe(key)
  if(quote.session_id){const existing=await stripe.checkout.sessions.retrieve(quote.session_id);if(existing.status==='open'&&existing.url)return NextResponse.json({url:existing.url,sessionId:existing.id});return NextResponse.json({error:'Check your account for ticket status before starting another checkout.'},{status:409})}
  if(!quote.reservation_id||!Number.isInteger(quote.amount_cents)||quote.amount_cents<=0)throw Error('Invalid reservation quote')
  // Stripe requires at least 30 minutes. Retry uses the original immutable expiry.
  if(quote.checkout_expires_at<Math.ceil(Date.now()/1000)+30*60)return NextResponse.json({error:'This checkout reservation is expiring. Please try again after it expires.'},{status:409})
  const metadata={kind:'ticket',site:'cafe-sativa',reservation_id:quote.reservation_id,event_id:eventId,event_slug:quote.slug,user_id:user.id}
  const session=await stripe.checkout.sessions.create({mode:'payment',customer_email:user.email,
   line_items:[{price_data:{currency:'usd',unit_amount:quote.amount_cents,product_data:{name:`Ticket — ${quote.title}`}},quantity:1}],
   expires_at:quote.checkout_expires_at,metadata,payment_intent_data:{metadata},
   success_url:`https://www.cafe-sativa.com/events/${encodeURIComponent(quote.slug)}?success=1`,cancel_url:`https://www.cafe-sativa.com/events/${encodeURIComponent(quote.slug)}?canceled=1`,
  },{idempotencyKey:`cs-ticket-${quote.reservation_id}`})
  const bound=await db.from('cs_ticket_reservations').update({stripe_session_id:session.id}).eq('id',quote.reservation_id).eq('user_id',user.id).is('stripe_session_id',null).select('id')
  if(bound.error)throw Error('Checkout binding failed')
  if(!bound.data?.length){const current=await db.from('cs_ticket_reservations').select('stripe_session_id').eq('id',quote.reservation_id).eq('user_id',user.id).maybeSingle();if(current.error||current.data?.stripe_session_id!==session.id)throw Error('Checkout binding conflict')}
  return NextResponse.json({url:session.url,sessionId:session.id})
 }catch{ return NextResponse.json({error:'Ticket checkout is temporarily unavailable.'},{status:503}) }
}
