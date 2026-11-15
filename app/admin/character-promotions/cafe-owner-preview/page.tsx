import {createClient} from '@/lib/supabase/server'
import {CAFE_OWNER_PREVIEW_SCOPE} from '@/lib/content/character-promo-cafe-owner-preview-server'
import OwnerPreview from './preview-client'
export const dynamic='force-dynamic'
export default async function Page(){
 const {data:{user},error}=await createClient().auth.getUser()
 if(error||user?.id!=='54b71f3f-19e1-46f0-99e2-28993463caf8'||user.app_metadata?.cafe_sativa_admin!==true)return <main><h1>Café owner preview</h1><p>Sign in with the authorized corporate owner account.</p></main>
 const scope=CAFE_OWNER_PREVIEW_SCOPE
 if(!scope.enabled||!scope.expiresAt||scope.expiresAt<=Date.now()||!scope.planIds.length)return <main><h1>Café owner preview</h1><p>Disabled: no reviewed finite ready-plan scope is configured. No approval or post has been created.</p></main>
 return <main><h1>Café owner preview</h1><p>Review a current server-verified plan. Confirming records finite approval only, not scheduling or publication.</p><OwnerPreview planIds={[...scope.planIds]}/></main>
}
