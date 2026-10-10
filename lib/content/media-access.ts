import { createClient } from '@/lib/supabase/server'
export async function canDownloadContentMedia() {
  try {
    const {data:{user},error}=await createClient().auth.getUser()
    if(error || !user)return false
    // Only trusted server-controlled flags grant downloads. VIP is deliberately off.
    return user.app_metadata?.cafe_sativa_admin===true || user.app_metadata?.cafe_sativa_manager===true
  }catch{return false}
}
