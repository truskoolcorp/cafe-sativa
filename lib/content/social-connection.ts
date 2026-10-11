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
  if(connection.last_error?.includes('OAuth invalid_grant') || connection.last_error?.includes('OAuth invalid_client')) {
    await db.from('cs_social_connections').update({lock_until:null}).eq('provider','metricool').eq('lock_until',connection.lock_until)
    throw new Error('Metricool reconnection required before delivery checks can resume')
  }
  let stage='administrator verification'
  try {
    const owner=await db.auth.admin.getUserById(connection.owner_id)
    if(owner.error || owner.data.user?.app_metadata?.cafe_sativa_admin!==true)throw new Error('Connection owner is no longer an authorized administrator')
    stage='encrypted credential verification'
    const credentials=unseal<any>(connection.credential_ciphertext,'credentials')
    stage='OAuth refresh'
    const refreshed=await providerJson('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:credentials.clientId,refresh_token:credentials.refresh_token,resource:METRICOOL_MCP}))
    if(typeof refreshed.access_token!=='string' || !refreshed.access_token || refreshed.token_type?.toLowerCase()!=='bearer')throw new Error('Metricool refresh failed')
    stage='rotated credential storage'
    const ciphertext=seal({...credentials,...refreshed,refresh_token:refreshed.refresh_token || credentials.refresh_token,clientId:credentials.clientId,obtainedAt:new Date().toISOString()},'credentials')
    const saved=await db.from('cs_social_connections').update({credential_ciphertext:ciphertext,updated_at:new Date().toISOString()}).eq('provider','metricool').eq('credential_ciphertext',connection.credential_ciphertext).select('provider').maybeSingle()
    if(saved.error || !saved.data)throw new Error('Social connection changed; retry the read-only check')
    stage='MCP session initialization'
    const session=await metricoolSession(refreshed.access_token)
    stage='approved social account verification'
    const brand=verifiedMetricoolBrand(await session.call('getBrandSettings',{}))
    stage='publishing tool contract verification'
    verifySocialToolContract(session.tools)
    const checked=await db.from('cs_social_connections').update({last_check_at:new Date().toISOString(),last_error:null,capabilities_verified:true}).eq('provider','metricool')
    if(checked.error)throw checked.error
    stage='delivery receipt or queue operation'
    return await operation({db,session,brand,enabled:connection.dispatch_enabled})
  }catch(error){
    const safeOAuth=error instanceof Error && /^Metricool OAuth [a-z_]+ \(HTTP \d{3}\)$/.test(error.message)?`: ${error.message}`:''
    const diagnostic=`Delivery check failed at ${stage}${safeOAuth}. No automatic submission retry.`
    await db.from('cs_social_connections').update({last_error:diagnostic}).eq('provider','metricool')
    console.error('[social-connection]',diagnostic)
    throw error
  }
  finally{await db.from('cs_social_connections').update({lock_until:null}).eq('provider','metricool').eq('lock_until',connection.lock_until)}
}
