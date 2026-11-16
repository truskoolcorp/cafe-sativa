import { NextResponse } from 'next/server'
import { isContentAdmin } from '@/lib/content/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!await isContentAdmin()) return NextResponse.json({error:'Unauthorized'}, {status:401})
  const db=createAdminClient()
  const result=await db.from('cs_podcast_sync_receipts')
    .select('id,trigger,state,started_at,finished_at,imported,existing,skipped,checked_feeds,error_code')
    .order('started_at',{ascending:false}).limit(10)
  if(result.error) return NextResponse.json({error:'Sync history unavailable'},{status:503,headers:{'Cache-Control':'private, no-store'}})
  return NextResponse.json({receipts:result.data||[]},{headers:{'Cache-Control':'private, no-store'}})
}