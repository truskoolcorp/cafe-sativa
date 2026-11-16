import {productionSlotDigest, type ProductionSlot} from './character-production-engine.ts'
import type {ProductionServerRpcClient} from './character-production-server-rpc.ts'
export type PlannerEvidence=Readonly<{brand:'cafe-sativa';accountId:string;slotDigest:string;canonicalRevision:string;providerBindingRevision:string;theme:string;rightsApproved:true;sourceBound:true;evidenceRef:string;observedAt:string}>
export type PlannerInput=Readonly<{slot:ProductionSlot;draftId:string;scheduledAt:string;theme:string;policyId:string;policyRevision:number;actorId:string}>
export interface PlannerDependencies {db:ProductionServerRpcClient;/** Must read current canon, source bindings, rights and policy. Never caller assertions. */validateCurrent(input:Readonly<PlannerInput>,digest:string,signal:AbortSignal):Promise<PlannerEvidence|null>}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/.test(v)
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.sort().join('|')
const inputKeys=['slot','draftId','scheduledAt','theme','policyId','policyRevision','actorId']
const slotKeys=['key','characterId','script','canonicalRevision','voiceId','portraitSha256','providerBindingRevision','provider','model','durationSeconds','authorizationId','authorizationExpiresAt','period','quoteCents','periodCapCents']
const evidenceKeys=['brand','accountId','slotDigest','canonicalRevision','providerBindingRevision','theme','rightsApproved','sourceBound','evidenceRef','observedAt']
const account='d61468fdf18c4b478f27857337ddd1ea'
const period=(at:number)=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit'}).formatToParts(at);return `${p.find(x=>x.type==='year')!.value}-${p.find(x=>x.type==='month')!.value}`}
const iso=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s
function valid(i:PlannerInput,now:number){
 if(!exact(i,inputKeys)||!exact(i.slot,slotKeys))return false
 const s=i.slot,t=Date.parse(i.scheduledAt)
 return uuid(i.draftId)&&uuid(i.policyId)&&uuid(i.actorId)&&Number.isSafeInteger(i.policyRevision)&&i.policyRevision>0&&id(i.theme)&&iso(i.scheduledAt)&&
 id(s.key)&&typeof s.characterId==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(s.characterId)&&!['keith','keith-ingram'].includes(s.characterId)&&
 typeof s.voiceId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s.voiceId)&&id(s.authorizationId)&&s.provider==='heygen'&&s.model==='avatar_iv'&&
 [s.canonicalRevision,s.portraitSha256,s.providerBindingRevision].every(hash)&&typeof s.script==='string'&&s.script.trim().length>0&&s.script.length<=5000&&!/building\s+caf[eé]\s+sativa/i.test(s.script)&&
 Number.isSafeInteger(s.durationSeconds)&&s.durationSeconds>=8&&s.durationSeconds<=45&&Number.isSafeInteger(s.quoteCents)&&s.quoteCents>0&&Number.isSafeInteger(s.periodCapCents)&&s.periodCapCents<=2000&&s.quoteCents<=s.periodCapCents&&
 Number.isSafeInteger(s.authorizationExpiresAt)&&s.authorizationExpiresAt>t&&t>=now&&t<=now+86_400_000&&s.period===period(now)&&s.period===period(t)&&s.period===period(s.authorizationExpiresAt-1)
}
/** Disabled-by-default planning only. No generation, publication, policy writes or retries.
 * SQL independently enforces atomic cadence, policy revision and cumulative cap.
 * An ambiguous outcome must be reconciled by the caller, never automatically retried.
 */
export function createCharacterProductionPlanner(config:Readonly<{enabled:boolean;now():number}>,open:()=>PlannerDependencies){
 const enabled=config.enabled===true,now=config.now
 return {async plan(input:PlannerInput,signal:AbortSignal){
  if(!enabled)return {status:'disabled' as const}
  if(signal.aborted)return {status:'blocked' as const}
  let i:Readonly<PlannerInput>,digest:string
  try {i=Object.freeze({...input,slot:Object.freeze({...input.slot})});if(!valid(i,now()))return {status:'blocked' as const};digest=productionSlotDigest(i.slot)}catch{return {status:'blocked' as const}}
  let d:PlannerDependencies,e:PlannerEvidence|null
  try{d=open();e=await d.validateCurrent(i,digest,signal)}catch{return {status:'blocked' as const}}
  const observed=now()
  if(signal.aborted||!valid(i,observed)||!e||!exact(e,evidenceKeys)||e.brand!=='cafe-sativa'||e.accountId!==account||e.slotDigest!==digest||e.canonicalRevision!==i.slot.canonicalRevision||e.providerBindingRevision!==i.slot.providerBindingRevision||e.theme!==i.theme||e.rightsApproved!==true||e.sourceBound!==true||typeof e.evidenceRef!=='string'||!e.evidenceRef.trim()||e.evidenceRef.length>500||!iso(e.observedAt)||Date.parse(e.observedAt)>observed||Date.parse(e.observedAt)<observed-60_000)return {status:'blocked' as const}
  const validation=Object.freeze({...e})
  const args={p_slot:i.slot,p_digest:digest,p_plan:{version:1,draftId:i.draftId,scheduledAt:i.scheduledAt,theme:i.theme,validation},p_policy_id:i.policyId,p_policy_revision:i.policyRevision,p_actor:i.actorId}
  try{
   const r=await d.db.rpc('character_production_plan',args).abortSignal(signal).retry(false)
   if(r.error)return {status:'held' as const}
   const receipt=r.data as Record<string,unknown>|null
   if(!receipt)return {status:'blocked' as const}
   if(!exact(receipt,['key','digest','draftId','replayed'])||receipt.key!==i.slot.key||receipt.digest!==digest||receipt.draftId!==i.draftId||typeof receipt.replayed!=='boolean')return {status:'held' as const}
   return {status:'planned' as const,key:i.slot.key,digest,draftId:i.draftId,replayed:receipt.replayed}
  }catch{return {status:'held' as const}}
 }}
}
