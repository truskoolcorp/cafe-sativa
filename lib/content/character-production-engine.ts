import {createHash} from 'node:crypto'
export type ProductionSlot=Readonly<{key:string;characterId:string;script:string;canonicalRevision:string;voiceId:string;portraitSha256:string;providerBindingRevision:string;provider:string;model:string;durationSeconds:number;authorizationId:string;authorizationExpiresAt:number;period:string;quoteCents:number;periodCapCents:number}>
export type Claim={token:string;digest:string}
export type Pending={key:string;token:string;digest:string;taskId:string;provider:string;model:string;providerBindingRevision:string}
export type Collected={bytes:Uint8Array;mime:'video/mp4'}
export type Collection={state:'pending'}|{state:'failed'}|({state:'completed'}&Collected)
export interface ProductionStore {
 /** Atomic nonreclaimable unique slot and independent cumulative provider/period budget. */
 claim(slot:ProductionSlot,digest:string):Promise<Claim|null>;
 markSubmitted(key:string,token:string,digest:string,taskId:string):Promise<boolean>;
 markUnknown(key:string,token:string,digest:string):Promise<void>;
 pending(provider:string,model:string,limit:number):Promise<Pending[]>;
 markFailed(job:Pending):Promise<void>;
 savePrivate(job:Pending,media:Collected&{sha256:string}):Promise<boolean>;
}
export interface ProductionProvider {name:string;submit(slot:ProductionSlot):Promise<{taskId:string}>;collect(taskId:string,providerBindingRevision:string):Promise<Collection>}
export interface EngineConfig {enabled:boolean;provider:string;model:string;maxVideoBytes:number;characters:readonly string[];now():number}
export interface EngineDependencies {store:ProductionStore;provider:ProductionProvider;/** Trusted current exact authority, canon, rights, quote and provider validation. */validateCurrent(slot:ProductionSlot):Promise<boolean>}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/.test(v)
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
export function productionSlotDigest(s:ProductionSlot){return createHash('sha256').update(JSON.stringify([s.key,s.characterId,s.script,s.canonicalRevision,s.voiceId,s.portraitSha256,s.provider,s.model,s.durationSeconds,s.authorizationId,s.authorizationExpiresAt,s.period,s.quoteCents,s.periodCapCents,s.providerBindingRevision])).digest('hex')}
function valid(s:ProductionSlot,c:EngineConfig){return !!s&&id(s.key)&&id(s.characterId)&&c.characters.includes(s.characterId)&&id(s.voiceId)&&id(s.authorizationId)&&s.provider===c.provider&&s.model===c.model&&[s.canonicalRevision,s.portraitSha256,s.providerBindingRevision].every(hash)&&typeof s.script==='string'&&!!s.script.trim()&&s.script.length<=5000&&Number.isSafeInteger(s.durationSeconds)&&s.durationSeconds>=1&&s.durationSeconds<=180&&Number.isSafeInteger(s.authorizationExpiresAt)&&s.authorizationExpiresAt>c.now()&&typeof s.period==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s.period)&&Number.isSafeInteger(s.quoteCents)&&s.quoteCents>0&&Number.isSafeInteger(s.periodCapCents)&&s.periodCapCents>=s.quoteCents}
/** Injectable disabled engine only. No scheduler, approval or publication API. */
export function createCharacterProductionEngine(configuration:EngineConfig,open:()=>EngineDependencies){
 const c=Object.freeze({...configuration,characters:Object.freeze([...configuration.characters])});let d:EngineDependencies|undefined
 const deps=()=>{if(!id(c.provider)||!id(c.model)||!Number.isSafeInteger(c.maxVideoBytes)||c.maxVideoBytes<12||c.maxVideoBytes>50_000_000)throw Error('Invalid engine configuration');if(!d){const candidate=open();if(candidate.provider.name!==c.provider)throw Error('Provider mismatch');d=candidate}return d}
 return {
 async produce(input:ProductionSlot){
  if(c.enabled!==true)return {status:'disabled' as const}
  const s=Object.freeze({...input});if(!valid(s,c))return {status:'blocked' as const}
  const x=deps(),digest=productionSlotDigest(s)
  try{if(await x.validateCurrent(s)!==true||!valid(s,c))return {status:'blocked' as const}}catch{return {status:'blocked' as const}}
  let claim:Claim|null
  try{claim=await x.store.claim(s,digest)}catch{return {status:'held' as const}}
  if(!claim||!id(claim.token)||claim.digest!==digest)return {status:'held' as const}
  claim=Object.freeze({...claim})
  const hold=async()=>{try{await x.store.markUnknown(s.key,claim!.token,digest)}catch{/* durable reservation stays held */}return {status:'held' as const}}
  try{
   if(await x.validateCurrent(s)!==true||!valid(s,c))return await hold()
   const receipt=await x.provider.submit(s)
   if(!receipt||!id(receipt.taskId))return await hold()
   if(await x.store.markSubmitted(s.key,claim.token,digest,receipt.taskId)!==true)return await hold()
   return {status:'submitted' as const}
  }catch{return await hold()}
 },
 async collect(limit=5){
  if(c.enabled!==true)return {status:'disabled' as const,checked:0,pendingQa:0,held:0}
  if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error('Invalid collection limit')
  const x=deps();let rows:Pending[]
  try{rows=await x.store.pending(c.provider,c.model,limit)}catch{return {status:'held' as const,checked:0,pendingQa:0,held:1}}
  const keys=new Set<string>(),tasks=new Set<string>()
  if(!Array.isArray(rows)||rows.length>limit||rows.some(r=>{if(!r||!id(r.key)||!id(r.token)||!id(r.taskId)||!hash(r.digest)||!hash(r.providerBindingRevision)||r.provider!==c.provider||r.model!==c.model||keys.has(r.key)||tasks.has(r.taskId))return true;keys.add(r.key);tasks.add(r.taskId);return false}))return {status:'held' as const,checked:0,pendingQa:0,held:1}
  const jobs=rows.map(r=>Object.freeze({...r}));let pendingQa=0,held=0
  for(const job of jobs){try{
   const result=await x.provider.collect(job.taskId,job.providerBindingRevision)
   if(result.state==='pending')continue
   if(result.state==='failed'){await x.store.markFailed(job);continue}
   if(result.state!=='completed'||result.mime!=='video/mp4'||!(result.bytes instanceof Uint8Array)||result.bytes.byteLength<12||result.bytes.byteLength>c.maxVideoBytes)throw Error('Invalid collected media')
   const bytes=Uint8Array.from(result.bytes)
   if(Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw Error('Invalid MP4')
   const sha256=createHash('sha256').update(bytes).digest('hex')
   if(await x.store.savePrivate(job,{bytes,mime:'video/mp4',sha256})===true)pendingQa++;else held++
  }catch{held++}}
  return {status:'collected' as const,checked:jobs.length,pendingQa,held}
 }
 }
}
