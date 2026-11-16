import { promoDispatchTimeIssue } from './character-promo-dispatch-time'
import { executeCharacterPromo, PromoApproval, PromoSources, PromoSnapshot, PromoReceipt } from './character-promo-delivery'
import { characterPromoDeliveryStore } from './character-promo-store'
type RPC=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
export type PromoDispatchDependencies={
 auth:{getUser():Promise<{data:{user:{id:string;app_metadata?:Record<string,unknown>}|null};error:unknown}>}
 rpc:RPC
 readCurrent(planId:string):Promise<{sources:PromoSources;approval:PromoApproval}>
 makeSubmit(preflight:()=>Promise<void>):(snapshot:PromoSnapshot,bytes:Uint8Array,revalidate:()=>Promise<void>)=>Promise<PromoReceipt>
 now():number
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
/** Explicit one-shot execution only. No grant creation, approval synthesis or retry. */
export async function dispatchCharacterPromo(input:{planId:string;reviewedDigest:string;explicitConfirmation:true;transmitApprovedVideo:true},deps:PromoDispatchDependencies,options:{enabled?:boolean}={}) {
 if(options.enabled!==true)return {status:'disabled' as const,publicationConfirmed:false}
 let claimStarted=false,token:string|null=null,actor='',epoch=0,snapshot:PromoSnapshot|null=null
 try {
  if(!uuid(input.planId)||!/^[a-f0-9]{64}$/.test(input.reviewedDigest)||input.explicitConfirmation!==true||input.transmitApprovedVideo!==true)throw Error('Exact explicit transmission confirmation required')
  const currentActor=async()=>{const r=await deps.auth.getUser();if(r.error||!r.data.user||!uuid(r.data.user.id)||r.data.user.app_metadata?.cafe_sativa_admin!==true||(actor&&r.data.user.id!==actor))throw Error('Current verified owner required');return r.data.user.id}
  actor=await currentActor()
  const authority=await deps.rpc('cs_authorize_character_promo_dispatch',{p_actor:actor})
  const a=authority.data as {actorId?:unknown;actorEpoch?:unknown}|null
  if(authority.error||!a||a.actorId!==actor||!Number.isSafeInteger(a.actorEpoch)||(a.actorEpoch as number)<0)throw Error('Current owner authority unavailable')
  epoch=a.actorEpoch as number // Never replace this epoch after revocation/restoration.
  const preflight=async()=>{
   await currentActor()
   if(!snapshot)throw Error('Exact approved snapshot unavailable')
   const r=await deps.rpc('cs_preflight_character_promo_dispatch',{p_actor:actor,p_actor_epoch:epoch,p_plan_id:input.planId,p_digest:input.reviewedDigest,p_snapshot:snapshot,p_token:token})
   if(r.error||r.data!==true)throw Error('Owner or exact dispatch authority changed')
  }
  const original=characterPromoDeliveryStore({rpc:deps.rpc})
  const submit=deps.makeSubmit(preflight)
  return await executeCharacterPromo({
   now:deps.now,
   readCurrent:async()=>{
    await currentActor()
    const current=await deps.readCurrent(input.planId)
    if(promoDispatchTimeIssue(current.approval.snapshot.scheduledAt,current.approval.snapshot.timezone))throw Error('Provider requires an exact unambiguous whole-second time')
    if(current.approval.digest!==input.reviewedDigest||current.approval.snapshot.planId!==input.planId)throw Error('Displayed approval changed')
    snapshot=JSON.parse(JSON.stringify(current.approval.snapshot)) as PromoSnapshot
    await preflight()
    return current
   },
   store:{
    async claim(value){
     await preflight()
     claimStarted=true
     const r=await deps.rpc('cs_claim_character_promo_as_owner',{p_actor:actor,p_actor_epoch:epoch,p_plan_id:value.planId,p_digest:value.digest,p_snapshot:value.approval.snapshot})
     if(r.error)throw Error('Claim outcome unconfirmed')
     if(r.data===null)return null
     if(!uuid(r.data))throw Error('Claim outcome unconfirmed')
     token=r.data
     return token
    },
    finish:original.finish,
   },
   submit:async(s,bytes,revalidate)=>{await preflight();return submit(s,bytes,revalidate)},
  },{enabled:true})
 }catch{
  return claimStarted?{status:'submission_unknown' as const,publicationConfirmed:false}:{status:'blocked' as const,publicationConfirmed:false,reason:'Current owner authority or exact approved evidence is unavailable. No provider submission was started.'}
 }
}
