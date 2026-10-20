import {NextResponse} from 'next/server'
import {isContentAdmin} from '@/lib/content/auth'
import {createAdminClient} from '@/lib/supabase/admin'
export const dynamic='force-dynamic'
export async function GET(){
 if(!await isContentAdmin())return NextResponse.json({error:'Unauthorized'},{status:401})
 const db=createAdminClient()
 const {data,error}=await db.from('cs_vip_recordings')
  .select('status,approved_at,release_at,storage_bucket')
  .limit(100)
 if(error)return NextResponse.json({error:'Verification unavailable'},{status:503})
 const now=Date.now()
 const recordings=data||[]
 let privateBucketVerified=true
 for(const bucket of [...new Set(recordings.filter(r=>r.status==='published').map(r=>r.storage_bucket))]){
  const check=await db.storage.getBucket(bucket)
  if(check.error||!check.data||check.data.public){privateBucketVerified=false;break}
 }
 const eligible=recordings.filter(r=>r.status==='published'&&!!r.approved_at&&!!r.release_at&&Date.parse(r.release_at)<=now).length
 return NextResponse.json({
  checks:{adminAuthenticated:true,unapprovedExcluded:recordings.every(r=>r.status!=='published'||!!r.approved_at),privatePublishedStorage:privateBucketVerified},
  catalog:{total:recordings.length,eligible,unreleased:recordings.length-eligible},
  note:'This verifies catalog invariants only. Real VIP-versus-standard session tests are still required.'
 },{headers:{'Cache-Control':'private, no-store'}})
}
