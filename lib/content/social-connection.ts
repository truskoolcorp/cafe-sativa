import { createAdminClient } from '@/lib/supabase/admin'
import { METRICOOL_MCP,providerJson,seal,unseal } from '@/lib/content/metricool-oauth'
import { metricoolSession,verifiedMetricoolBrand } from '@/lib/content/metricool-mcp'
import { verifySocialToolContract } from '@/lib/content/social-contract'

export async function withSocialConnection<T>(operation:(context:{db:ReturnType<typeof createAdminClient>;session:Awaited<ReturnType<typeof metricoolSession>>;brand:ReturnType<typeof verifiedMetricoolBrand>;enabled:boolean})=>Promise<T>) {
  const db=createAdminClient()
  const claim=await db.rpc('cs_claim_social_connection')
  if(claim.error)throw claim.error
  const connection=claim.data?.[0]
  if(!connection)throw new Error('Social connection unavailable or busy')
  try {
    const owner=await db.auth.admin.getUserById(connection.owner_id)
    if(owner.error || owner.data.user?.app_metadata?.cafe_sativa_admin!==true)throw new Error('Connection owner is no longer an authorized administrator')
    const credentials=unseal<any>(connection.credential_ciphertext,'credentials')
    const refreshed=await providerJson('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:credentials.clientId,refresh_token:credentials.refresh_token,resource:METRICOOL_MCP}))
    if(typeof refreshed.access_token!=='string' || !refreshed.access_token || refreshed.token_type?.toLowerCase()!=='bearer')throw new Error('Metricool refresh failed')
    const ciphertext=seal({...credentials,...refreshed,refresh_token:refreshed.refresh_token || credentials.refresh_token,clientId:credentials.clientId,obtainedAt:new Date().toISOString()},'credentials')
    const saved=await db.from('cs_social_connections').update({credential_ciphertext:ciphertext,updated_at:new Date().toISOString()}).eq('provider','metricool').eq('credential_ciphertext',connection.credential_ciphertext).select('provider').maybeSingle()
    if(saved.error || !saved.data)throw new Error('Social connection changed; retry the read-only check')
    const session=await metricoolSession(refreshed.access_token)
    const brand=verifiedMetricoolBrand(await session.call('getBrandSettings',{}))
    verifySocialToolContract(session.tools)
    const checked=await db.from('cs_social_connections').update({last_check_at:new Date().toISOString(),last_error:null,capabilities_verified:true}).eq('provider','metricool')
    if(checked.error)throw checked.error
    return await operation({db,session,brand,enabled:connection.dispatch_enabled})
  }catch(error){await db.from('cs_social_connections').update({last_error:'Delivery check failed. Test or reconnect the Metricool connection; no automatic submission retry.'}).eq('provider','metricool');throw error}
  finally{await db.from('cs_social_connections').update({lock_until:null}).eq('provider','metricool').eq('lock_until',connection.lock_until)}
}
