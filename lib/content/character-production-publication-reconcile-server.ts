import 'server-only'
import {createAdminClient} from '@/lib/supabase/admin'
import {createProductionFetch} from './character-production-bounded-fetch'
import {cafeBoundedReadFetch} from './character-promo-cafe-read-fetch'
import {metricoolSession} from './metricool-mcp'
import {unseal} from './metricool-oauth'
import type {ProductionServerRpcClient} from './character-production-server-rpc'
import {reconcileCafePublication,type PublicationAttempt} from './character-production-publication-reconcile'
/** Actual finite read-only provider operation and scoped positive-receipt write.
 * No provider publish/edit/retry or credential refresh. Existing verified
 * connection is read only; these two RPC capabilities require separate review.
 * Disabled by default; no route or automatic activation is installed here. */
export function createCafePublicationReconciliationOperation(planId:string,capability:ProductionServerRpcClient|null){
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(planId))throw Error('Exact plan required')
 const enabled=()=>process.env.CS_CAFE_PUBLICATION_RECONCILIATION_ENABLED==='true'
 let used=false,closing=false,work:Promise<unknown>|undefined,network:ReturnType<typeof createProductionFetch>|undefined
 return {async run(parent:AbortSignal){
  if(used||closing||parent.aborted||!enabled()||!capability)return {status:'disabled' as const}
  used=true;const signal=AbortSignal.any([parent,AbortSignal.timeout(55000)]),check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Reconciliation disabled')}
  work=(async()=>{
   check();network=createProductionFetch(signal);const db=createAdminClient(cafeBoundedReadFetch(network.fetch))
   const read=async()=>{check();const r=await db.from('cs_social_connections').select('owner_id,status,brand_id,user_id,credential_ciphertext,last_error').eq('provider','metricool').maybeSingle();check();const c=r.data;if(r.error||!c||typeof c.owner_id!=='string'||c.status!=='verified'||String(c.brand_id)!=='5373515'||String(c.user_id)!=='4174093'||typeof c.credential_ciphertext!=='string'||/OAuth invalid_(grant|client)/.test(c.last_error??''))throw Error('Verified existing connection unavailable');const owner=await db.auth.admin.getUserById(c.owner_id);check();if(owner.error||owner.data.user?.app_metadata?.cafe_sativa_admin!==true)throw Error('Connection owner unavailable');return c}
   const original=await read(),fingerprint=JSON.stringify(original),credentials=unseal(original.credential_ciphertext,'credentials') as Record<string,unknown>,obtained=Date.parse(typeof credentials.obtainedAt==='string'?credentials.obtainedAt:''),expires=Number(credentials.expires_in)
   if(typeof credentials.access_token!=='string'||!credentials.access_token||typeof credentials.token_type!=='string'||credentials.token_type.toLowerCase()!=='bearer'||!Number.isFinite(obtained)||obtained>Date.now()||!Number.isFinite(expires)||expires<=0||obtained+expires*1000<=Date.now()+60000)throw Error('Read-only connection expired')
   const current=async()=>{if(JSON.stringify(await read())!==fingerprint||obtained+expires*1000<=Date.now()+60000)throw Error('Connection changed')}
   const readAttempt=async()=>{check();const r=await capability.rpc('cs_cafe_publication_attempt',{p_plan:planId}).abortSignal(signal).retry(false);check();if(r.error||!r.data||r.data.planId!==planId)throw Error('Scheduled app attempt unavailable');return r.data as PublicationAttempt}
   const attempt=await readAttempt(),attemptFingerprint=JSON.stringify(attempt),session=await metricoolSession(credentials.access_token,signal)
   const result=await reconcileCafePublication(attempt,{async call(name,args){await current();check();const out=await session.call(name,args);check();await current();return out}},signal,enabled)
   if(result.status!=='published')return result
   await current();if(JSON.stringify(await readAttempt())!==attemptFingerprint)throw Error('Scheduled attempt changed')
   check();const saved=await capability.rpc('cs_record_cafe_publication_receipt',{p_plan:planId,p_token:attempt.token,p_digest:attempt.digest,p_receipt:result.receipt,p_evidence:result.evidence}).abortSignal(signal).retry(false);check()
   if(saved.error||saved.data!==true)throw Error('Publication receipt persistence unconfirmed')
   return {status:'publication_recorded' as const,planId,network:attempt.network,publicUrl:result.receipt.publicUrl}
  })();return await work
 },async whenSettled(){closing=true;const done=await Promise.allSettled(work?[work]:[]);await network?.whenSettled();if(done.some(r=>r.status==='rejected'))throw Error('Reconciliation settled with failure')}}
}
