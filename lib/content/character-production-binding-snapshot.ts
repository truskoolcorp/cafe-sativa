import {createHash} from 'node:crypto'
import {productionSlotDigest,type ProductionSlot} from './character-production-engine'
import {canonicalImageDigest,imageApprovedAvatar,type CanonicalImageBinding} from './character-production-canonical-image'
import {heyGenBindingRevision} from './character-production-provider-heygen'
import type {SelectedItem} from './character-production-selected-session'
import type {ProductionRpc} from './character-production-store'
export type BindingSnapshot={version:1;account:{linkId:string;model:'avatar_iv';aspectRatio:'9:16'|'16:9';expectedUsername:string};image:CanonicalImageBinding;speech:{key:string;claimSha256:string;receiptSha256:string;scopeId:string;textAttemptKey:string;textAttemptToken:string;textSourceDigest:string}}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const hex=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)
const exact=(x:unknown,keys:string[])=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.sort().join(',')
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)
const stable=(x:unknown):string=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
/** Structural/integrity verification, NOT evidence acquisition. Only a trusted
 * server which read actual fresh receipt, canon, scene and quote may plan this.
 * Preserve raw serialization so PostgreSQL and JS hash exactly the same bytes. */
export function verifyBindingSnapshot(text:string,sha:string,slot:ProductionSlot):BindingSnapshot{
 if(typeof text!=='string'||Buffer.byteLength(text)>32768||!hex(sha)||hash(text)!==sha)throw Error('Binding snapshot integrity unavailable')
 const b=JSON.parse(text) as BindingSnapshot
 if(!exact(b,['version','account','image','speech'])||b.version!==1||!exact(b.account,['linkId','model','aspectRatio','expectedUsername'])||b.account.model!=='avatar_iv'||!['9:16','16:9'].includes(b.account.aspectRatio)||typeof b.account.expectedUsername!=='string'||!b.account.expectedUsername.trim()||b.account.expectedUsername.length>240)throw Error('Binding account unavailable')
 const i=b.image,a=i?.audio,p=b.speech
 if(!exact(i,['characterId','canonicalRevision','portraitSha256','imageBytes','mime','audio',...(i?.approvedScene?['approvedScene']:[])])||!exact(a,['characterId','avatarId','voiceId','voiceModel','canonicalRevision','portraitSha256','scriptSha256','audioSha256','audioBytes','mime','provider','synthesisReceiptId'])||!exact(p,['key','claimSha256','receiptSha256','scopeId','textAttemptKey','textAttemptToken','textSourceDigest'])||!uuid(p.scopeId)||!uuid(p.textAttemptToken)||![p.claimSha256,p.receiptSha256,p.textSourceDigest].every(hex)||!/^daily:\d{4}-\d{2}-\d{2}:zaria-solenne$/.test(p.textAttemptKey))throw Error('Original speech provenance unavailable')
 if(i.approvedScene&&!exact(i.approvedScene,['imageSha256','approvalReference']))throw Error('Scene snapshot unavailable')
 canonicalImageDigest(i)
 if(i.characterId!=='zaria-solenne'||slot.characterId!==i.characterId||slot.canonicalRevision!==i.canonicalRevision||slot.portraitSha256!==i.portraitSha256||slot.voiceId!==a.voiceId||a.scriptSha256!==hash(slot.script)||slot.provider!=='heygen'||slot.model!=='avatar_iv'||p.key!=='fresh-zaria-'+hash(JSON.stringify([p.textAttemptKey,p.textAttemptToken,a.scriptSha256]))||heyGenBindingRevision(b.account,imageApprovedAvatar(i))!==slot.providerBindingRevision)throw Error('Exact occurrence binding mismatch')
 return structuredClone(b)
}
/** The selected-token SQL reader reuses existing current authority and exact
 * original submitted task eligibility. It never changes selected work or
 * accepts a replacement binding. Receipt/media bytes still require existing
 * verifier at planning and native provider preparation; hashes are not QA. */
export function createSelectedBindingReader(d:{rpc:ProductionRpc;signal:AbortSignal;enabled:()=>boolean}){
 const check=()=>{d.signal.throwIfAborted();if(!d.enabled())throw Error('Binding reader disabled')}
 return {async read(expected:SelectedItem){
  check();const e=structuredClone(expected)
  if(!['generate','collect'].includes(e.phase)||!uuid(e.enrollmentId)||!uuid(e.selectionToken))throw Error('Binding phase unavailable')
  const started=Date.now()
  const r=await d.rpc.rpc('character_production_selected_binding',{p_enrollment:e.enrollmentId,p_token:e.selectionToken});check()
  if(r.error||!exact(r.data,['selected','slot','snapshotText','snapshotSha256']))throw Error('Original binding read unavailable')
  const data=r.data as {selected:SelectedItem;slot:ProductionSlot;snapshotText:string;snapshotSha256:string}
  if(!Number.isSafeInteger(data.selected?.observedAt)||data.selected.observedAt<started||data.selected.observedAt>Date.now())throw Error('Stale binding selection')
  if(stable({...data.selected,observedAt:0})!==stable({...e,observedAt:0})||data.slot.key!==e.key||productionSlotDigest(data.slot)!==e.digest)throw Error('Selected binding identity changed')
  if(e.phase==='generate'&&stable((e.payload as {slot:ProductionSlot}).slot)!==stable(data.slot))throw Error('Generation slot changed')
  if(e.phase==='collect'&&(e.payload as {providerBindingRevision:string}).providerBindingRevision!==data.slot.providerBindingRevision)throw Error('Original task binding changed')
  const snapshot=verifyBindingSnapshot(data.snapshotText,data.snapshotSha256,data.slot);check()
  return {slot:structuredClone(data.slot),snapshot,snapshotSha256:data.snapshotSha256}
 }}
}

/** Narrow adapter for the existing planner, not a second planner/writer. Caller
 * must obtain real source evidence before constructing this boundary. New SQL
 * wrapper executes existing draft writer and snapshot insertion atomically. */
export function bindSnapshotPlannerRpc(db:import('./character-production-server-rpc').ProductionServerRpcClient,slot:ProductionSlot,snapshotText:string,enabled:()=>boolean):import('./character-production-server-rpc').ProductionServerRpcClient{
 const fixed=structuredClone(slot),text=snapshotText,digest=hash(text)
 verifyBindingSnapshot(text,digest,fixed)
 return {rpc(name,args){
  if(name!=='character_production_plan'||!enabled()||stable(args.p_slot)!==stable(fixed)||args.p_digest!==productionSlotDigest(fixed)||(args.p_plan as {validation?:{evidenceRef?:string}})?.validation?.evidenceRef!=='binding-snapshot-sha256:'+digest)throw Error('Exact bound plan required')
  const frozen=structuredClone(args)
  return {abortSignal(signal){return {async retry(retry){
   signal.throwIfAborted();if(retry!==false||!enabled())throw Error('Bound plan disabled')
   const r=await db.rpc('character_production_plan_bound',{...frozen,p_snapshot:text}).abortSignal(signal).retry(false)
   signal.throwIfAborted();if(!enabled())throw Error('Bound plan outcome held')
   if(r.error||r.data===null)return r
   if(!exact(r.data,['key','digest','draftId','replayed','snapshotSha256']))throw Error('Bound plan receipt unconfirmed')
   const out=r.data as Record<string,unknown>
   if(out.snapshotSha256!==digest)throw Error('Bound plan snapshot receipt mismatch')
   const {snapshotSha256:_,...legacy}=out
   return {data:legacy,error:null}
  }}}}
 }}
}
