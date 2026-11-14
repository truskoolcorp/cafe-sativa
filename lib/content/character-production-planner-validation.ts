import type {PlannerInput,PlannerEvidence} from './character-production-planner.ts'
export type PlanningPolicy={id:string;revision:number;enabled:boolean;expiresAt:number;ownerEvidenceRef:string;characters:readonly string[];themes:readonly string[];capCents:number;accountId:string}
export type PlanningBinding={digest:string;providerBindingRevision:string;accountId:string;sourceBound:boolean;rightsApproved:boolean;themeApproved:boolean;quoteCents:number;observedAt:string;evidenceRef:string}
export interface PlannerValidationSources {
 now():number;
 readPolicy(id:string,signal:AbortSignal):Promise<PlanningPolicy|null>;
 readCanon(signal:AbortSignal):Promise<unknown>;
 normalizeCanon(body:unknown,characterId:string,observedAt:string):unknown;
 /** Resolves exact approved image/audio and current provider/quote/theme evidence. Read-only. */
 readBinding(input:Readonly<PlannerInput>,digest:string,signal:AbortSignal):Promise<PlanningBinding|null>;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
function freezePolicy(p:PlanningPolicy|null){return p?Object.freeze({...p,characters:Object.freeze([...p.characters]),themes:Object.freeze([...p.themes])}):null}
function permission(p:PlanningPolicy|null,i:PlannerInput,now:number){return !!p&&p.id===i.policyId&&p.revision===i.policyRevision&&p.enabled===true&&Number.isSafeInteger(p.expiresAt)&&p.expiresAt>=i.slot.authorizationExpiresAt&&p.expiresAt>now&&typeof p.ownerEvidenceRef==='string'&&p.ownerEvidenceRef.trim().length>0&&p.characters.includes(i.slot.characterId)&&p.themes.includes(i.theme)&&p.capCents===i.slot.periodCapCents&&p.capCents<=2000&&p.accountId==='d61468fdf18c4b478f27857337ddd1ea'}
/** No writes. A policy epoch read brackets live canon and exact source evidence.
 * Sources must be trusted server transports; never expose this as a caller
 * assertion endpoint. Finite timeout and external abort suppress stale success.
 */
export function createPlannerValidator(sources:PlannerValidationSources,budgetMs=8000){
 if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>10000)throw Error('Invalid validation budget')
 const readPolicy=sources.readPolicy.bind(sources),readCanon=sources.readCanon.bind(sources),normalize=sources.normalizeCanon.bind(sources),readBinding=sources.readBinding.bind(sources),now=sources.now.bind(sources)
 return async(i:Readonly<PlannerInput>,digest:string,outer:AbortSignal):Promise<PlannerEvidence|null>=>{
  if(outer.aborted)return null
  const controller=new AbortController(),start=now(),deadline=performance.now()+budgetMs
  let timer:ReturnType<typeof setTimeout>|undefined,settle:(value:null)=>void=()=>{}
  const aborted=()=>{controller.abort();settle(null)}
  outer.addEventListener('abort',aborted,{once:true})
  const timely=()=>!outer.aborted&&!controller.signal.aborted&&performance.now()<deadline&&now()>=start&&now()<i.slot.authorizationExpiresAt
  const fresh=(v:string,a:number,b:number)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)>=a&&Date.parse(v)<=b
  try{return await Promise.race([(async()=>{
   const first=freezePolicy(await readPolicy(i.policyId,controller.signal));if(!timely()||!permission(first,i,now()))return null
   const canonStart=now(),body=await readCanon(controller.signal),canonEnd=now()
   if(!timely()||!object(body)||!fresh(body.verifiedAt as string,canonStart,canonEnd))return null
   const canon=normalize(body,i.slot.characterId,new Date(canonEnd).toISOString())
   if(!object(canon)||canon.live!==true||canon.production_ready!==true||canon.rights_status!=='approved'||canon.voice_status!=='canonical'||canon.character_id!==i.slot.characterId||canon.revision_sha256!==i.slot.canonicalRevision||canon.portrait_sha256!==i.slot.portraitSha256||canon.voice_id!==i.slot.voiceId)return null
   const bindingStart=now(),b=await readBinding(i,digest,controller.signal),bindingEnd=now()
   if(!timely()||!b||!fresh(b.observedAt,bindingStart,bindingEnd)||b.digest!==digest||b.providerBindingRevision!==i.slot.providerBindingRevision||b.accountId!==first!.accountId||b.sourceBound!==true||b.rightsApproved!==true||b.themeApproved!==true||b.quoteCents!==i.slot.quoteCents||typeof b.evidenceRef!=='string'||!b.evidenceRef.trim()||b.evidenceRef.length>500)return null
   const binding=Object.freeze({...b}),second=freezePolicy(await readPolicy(i.policyId,controller.signal))
   if(!timely()||!permission(second,i,now())||JSON.stringify(second)!==JSON.stringify(first))return null
   return Object.freeze({brand:'cafe-sativa' as const,accountId:first!.accountId,slotDigest:digest,canonicalRevision:i.slot.canonicalRevision,providerBindingRevision:i.slot.providerBindingRevision,theme:i.theme,rightsApproved:true as const,sourceBound:true as const,evidenceRef:binding.evidenceRef,observedAt:new Date(now()).toISOString()})
  })(),new Promise<null>(resolve=>{settle=resolve;timer=setTimeout(aborted,budgetMs);if(outer.aborted)aborted()})])}catch{return null}finally{clearTimeout(timer);outer.removeEventListener('abort',aborted);controller.abort()}
 }
}
