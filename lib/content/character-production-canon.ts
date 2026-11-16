import {productionSlotDigest} from './character-production-engine.ts'
import type {ProductionSlot} from './character-production-engine.ts'
export type GenerationAuthorization={id:string;digest:string;revision:string;enabled:boolean;expiresAt:number}
export interface GenerationValidationSources {
 now():number;
 readAuthorization(key:string,id:string,signal:AbortSignal):Promise<GenerationAuthorization|null>;
 readCanon(signal:AbortSignal):Promise<unknown>;
 normalizeCanon(body:unknown,characterId:string,observedAt:string):unknown;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
function permission(a:GenerationAuthorization|null,s:ProductionSlot,now:number){return !!a&&a.enabled===true&&a.id===s.authorizationId&&a.digest===productionSlotDigest(s)&&typeof a.revision==='string'&&a.revision.length>0&&a.revision.length<=240&&Number.isSafeInteger(a.expiresAt)&&a.expiresAt===s.authorizationExpiresAt&&a.expiresAt>now}
/** Always uses the deployment's current upstream normalizer, never a snapshot or
 * a parallel revision algorithm. Epoch reads surround current canonical read. */
export function createGenerationValidator(sources:GenerationValidationSources,budgetMs=8000){
 if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>10000)throw Error('Invalid canonical budget')
 const readAuth=sources.readAuthorization.bind(sources),readCanon=sources.readCanon.bind(sources),normalize=sources.normalizeCanon.bind(sources),now=sources.now.bind(sources)
 return async(input:ProductionSlot):Promise<boolean>=>{
  const s=Object.freeze({...input}),start=now(),deadline=performance.now()+budgetMs,controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  const timely=()=>!controller.signal.aborted&&performance.now()<deadline&&now()>=start&&now()<s.authorizationExpiresAt
  try{return await Promise.race([(async()=>{
   const first=await readAuth(s.key,s.authorizationId,controller.signal)
   const before=first?Object.freeze({...first}):null
   if(!timely()||!permission(before,s,now()))return false
   const readStart=now(),body=await readCanon(controller.signal),readEnd=now()
   if(!timely()||!object(body)||typeof body.verifiedAt!=='string')return false
   const verified=Date.parse(body.verifiedAt)
   if(!Number.isFinite(verified)||verified<readStart||verified>readEnd)return false
   const canon=normalize(body,s.characterId,new Date(readEnd).toISOString())
   if(!object(canon)||canon.live!==true||canon.production_ready!==true||canon.rights_status!=='approved'||canon.voice_status!=='canonical'||canon.character_id!==s.characterId||canon.revision_sha256!==s.canonicalRevision||canon.portrait_sha256!==s.portraitSha256||canon.voice_id!==s.voiceId)return false
   const second=await readAuth(s.key,s.authorizationId,controller.signal)
   const after=second?Object.freeze({...second}):null
   return timely()&&permission(after,s,now())&&after!.revision===before!.revision
  })(),new Promise<false>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(false)},budgetMs)})])}catch{return false}finally{clearTimeout(timer);controller.abort()}
 }
}
