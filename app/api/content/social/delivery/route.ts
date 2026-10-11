import { NextRequest,NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { processSocialDelivery } from '@/lib/content/social-delivery'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(req:NextRequest) {
  if(!cronAuthorized(req.headers.get('authorization')))return NextResponse.json({error:'Unauthorized'},{status:401})
  try {
    const db=createAdminClient(),now=Date.now()
    const [queued,stale,receipt]=await Promise.all([
      db.from('cs_social_deliveries').select('id').eq('state','queued').limit(1),
      db.from('cs_social_deliveries').select('id').eq('state','submitting').lt('submitted_at',new Date(now-600000).toISOString()).limit(1),
      db.from('cs_social_deliveries').select('checked_at').eq('state','scheduled').gte('scheduled_at',new Date(now-7*86400000).toISOString()).order('checked_at',{ascending:true,nullsFirst:true}).limit(1),
    ])
    if(queued.error || stale.error || receipt.error)throw Error('Delivery queue unavailable')
    const needed=Boolean(queued.data?.length || stale.data?.length || receipt.data?.some(row=>!row.checked_at || new Date(row.checked_at).getTime()<now-3600000))
    return NextResponse.json(needed?await processSocialDelivery():{status:'idle',reason:'No queued delivery or receipt check due'},{headers:{'Cache-Control':'no-store'}})
  }catch{return NextResponse.json({error:'Delivery check failed; inspect administrator status before retrying.'},{status:503})}
}
