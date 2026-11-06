import type { createAdminClient } from '@/lib/supabase/admin'
// Receipt age is not evidence of publication or failure. Keep historical deliveries
// eligible after outages, but throttle provider checks and bound each batch.
export function dueSocialReceipts(db:ReturnType<typeof createAdminClient>,now=Date.now(),limit=20) {
  const cutoff=new Date(now-3600000).toISOString()
  return db.from('cs_social_deliveries').select('*').eq('state','scheduled')
    .or(`checked_at.is.null,checked_at.lt.${cutoff}`)
    .order('checked_at',{ascending:true,nullsFirst:true}).limit(limit)
}
