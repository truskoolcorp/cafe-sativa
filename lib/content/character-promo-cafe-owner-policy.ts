import {createHash} from 'node:crypto'
import type {CafeApprovalWriterDeps} from './character-promo-cafe-approval'
import {cafeScheduleDigest,validateCafeSchedule} from './character-promo-cafe-metricool'
import type {CafeCollaborator} from './character-promo-cafe-metricool'

/** Trusted immutable policy material recovered from owner-authored messages.
 * NOT a caller form, admin's self-grant, QA pass, or permission to buy ads. */
export type CafeOwnerPolicy={
 version:1;reference:string;ownerMessageIds:readonly string[];authorizedAt:string
 /** Operational lease on the resolver, not a claim the owner imposed expiry. */
 validUntil:string;revoked:boolean;brandId:'7605217';userId:'4174093'
 accounts:readonly [{network:'facebook';accountId:'105363501666032'},{network:'instagram';accountId:'cafesativainc'}]
 characterIds:readonly string[]
 scope:'routine-cafe-persona-brand-promotions';paidPromotion:false
}
export type CafeScopeAssessment={
 scheduleDigest:string;assessedAt:string;evidenceRef:string
 classification:'routine-cafe-persona-brand-promotion'|'out-of-scope'|'uncertain'
 /** Must describe actual semantic review of script/caption/platform metadata.
  * A technical watermark pass alone cannot supply this judgment. */
 highImpact:false|true;paidPromotion:false|true;containsSensitivePersonalData:false|true
}
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)
const ref=(v:string)=>/^[A-Za-z0-9_.:-]{1,200}$/.test(v)
/** Binds a fresh exact schedule to standing owner permission, without pretending
 * each generated caption was personally approved. Does NOT write anything.
 * Current policy revocation is reread for each invocation, never cached here. */
export function createCafeOwnerPolicyResolver(d:{
 now():number;readPolicy():Promise<CafeOwnerPolicy|null>
 assessScope(scheduleDigest:string):Promise<CafeScopeAssessment|null>
 verifiedCollaborators:readonly CafeCollaborator[]
}):CafeApprovalWriterDeps['ownerAuthority']{
 return async(input,digest)=>{
  const s=JSON.parse(JSON.stringify(input)),raw=await d.readPolicy(),p=raw?JSON.parse(JSON.stringify(raw)) as CafeOwnerPolicy:null
  const now=d.now()
  if(!p||p.version!==1||p.revoked||p.scope!=='routine-cafe-persona-brand-promotions'||p.paidPromotion!==false||p.brandId!=='7605217'||p.userId!=='4174093'||!ref(p.reference)||!Array.isArray(p.ownerMessageIds)||!p.ownerMessageIds.length||p.ownerMessageIds.length>20||p.ownerMessageIds.some(x=>!/^Sentinel_[a-f0-9]{32}$/.test(x))||new Set(p.ownerMessageIds).size!==p.ownerMessageIds.length||!Array.isArray(p.characterIds)||!p.characterIds.length||!p.characterIds.includes(s.characterId)||!Number.isFinite(Date.parse(p.authorizedAt))||Date.parse(p.authorizedAt)>now||!Number.isFinite(Date.parse(p.validUntil))||Date.parse(p.validUntil)<=now)return null
  if(stable(p.accounts)!==stable([{network:'facebook',accountId:'105363501666032'},{network:'instagram',accountId:'cafesativainc'}])||cafeScheduleDigest(s)!==digest)return null
  try{validateCafeSchedule(s,d.verifiedCollaborators,now)}catch{return null}
  const rawAssessment=await d.assessScope(digest),a=rawAssessment?JSON.parse(JSON.stringify(rawAssessment)) as CafeScopeAssessment:null,after=d.now()
  if(!a||a.scheduleDigest!==digest||a.classification!=='routine-cafe-persona-brand-promotion'||a.highImpact!==false||a.paidPromotion!==false||a.containsSensitivePersonalData!==false||!ref(a.evidenceRef)||!Number.isFinite(Date.parse(a.assessedAt))||Date.parse(a.assessedAt)>after||after-Date.parse(a.assessedAt)>60000||after<now||after>=Date.parse(p.validUntil))return null
  const current=await d.readPolicy()
  if(!current||stable(current)!==stable(p)||d.now()>=Date.parse(p.validUntil))return null
  // Reference commits both immutable policy and exact semantic scope evidence.
  const record=stable({policy:p,assessment:a}),evidenceSha=createHash('sha256').update(record).digest('hex'),reference='cafe-policy:'+evidenceSha
  const finalPolicy=await d.readPolicy()
  if(!finalPolicy||stable(finalPolicy)!==stable(p)||d.now()>=Date.parse(p.validUntil)||d.now()-Date.parse(a.assessedAt)>60000)return null
  return {reference,evidenceRecord:record,scheduleDigest:digest,authorizedAt:p.authorizedAt,expiresAt:new Date(Math.min(Date.parse(p.validUntil),after+24*3600000)).toISOString(),revoked:false}
 }
}

