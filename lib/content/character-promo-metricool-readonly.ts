import type { SupabaseClient } from '@supabase/supabase-js'

type ReadonlyDependencies={
  db:Pick<SupabaseClient,'from'|'auth'>
  decrypt(ciphertext:string):unknown
  openSession(token:string):Promise<{call(name:'getBrandSettings',args:object):Promise<unknown>}>
  now():number
}
export class PromoConnectionReadError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='PromoConnectionReadError'}
}
/** No locks, refresh, health updates, writes, logs or general-purpose session escape. */
export async function readPromoMetricoolBrands(deps:ReadonlyDependencies):Promise<unknown> {
  try {
    const read=()=>deps.db.from('cs_social_connections').select('owner_id,status,brand_id,user_id,credential_ciphertext,last_error').eq('provider','metricool').maybeSingle()
    const first=await read(),c=first.data
    if(first.error||!c||typeof c.owner_id!=='string'||typeof c.credential_ciphertext!=='string')throw new PromoConnectionReadError('metricool_connection_missing','Existing authorized Metricool connection unavailable')
    if(c.status!=='verified'||String(c.brand_id)!=='5373515'||String(c.user_id)!=='4174093')throw new PromoConnectionReadError('metricool_connection_revoked','Existing Metricool connection is revoked or not the verified Tru Skool mapping')
    if(typeof c.last_error==='string' && /OAuth invalid_(grant|client)/.test(c.last_error))throw new PromoConnectionReadError('metricool_reconnect_required','Metricool reconnection is required; read-only review cannot refresh credentials')
    const owner=await deps.db.auth.admin.getUserById(c.owner_id)
    if(owner.error||owner.data.user?.app_metadata?.cafe_sativa_admin!==true)throw new PromoConnectionReadError('metricool_owner_unavailable','Connection owner is no longer an authorized administrator')
    const credentials=deps.decrypt(c.credential_ciphertext) as Record<string,unknown>
    const obtained=Date.parse(typeof credentials?.obtainedAt==='string'?credentials.obtainedAt:'')
    const expires=Number(credentials?.expires_in),now=deps.now()
    if(typeof credentials?.access_token!=='string'||!credentials.access_token||typeof credentials.token_type!=='string'||credentials.token_type.toLowerCase()!=='bearer'||!Number.isFinite(obtained)||obtained>now||!Number.isFinite(expires)||expires<=0||obtained+expires*1000<=now+60000)throw new PromoConnectionReadError('metricool_reconnect_required','Metricool bearer access is expired, expiring or unverified; read-only review cannot refresh credentials')
    const session=await deps.openSession(credentials.access_token)
    const brands=await session.call('getBrandSettings',{})
    const last=await read()
    const currentOwner=await deps.db.auth.admin.getUserById(c.owner_id)
    if(last.error||!last.data||last.data.status!==c.status||String(last.data.brand_id)!==String(c.brand_id)||String(last.data.user_id)!==String(c.user_id)||last.data.owner_id!==c.owner_id||last.data.credential_ciphertext!==c.credential_ciphertext||last.data.last_error!==c.last_error||currentOwner.error||currentOwner.data.user?.app_metadata?.cafe_sativa_admin!==true)throw new PromoConnectionReadError('metricool_connection_changed','Metricool authorization changed during verification; reload required')
    if(obtained+expires*1000<=deps.now()+60000)throw new PromoConnectionReadError('metricool_reconnect_required','Metricool bearer access expired during review; reconnect outside this read-only workflow')
    return brands
  } catch(error) {
    if(error instanceof PromoConnectionReadError)throw error
    throw new PromoConnectionReadError('metricool_read_failed','Read-only Metricool verification failed; no refresh or write was attempted')
  }
}
