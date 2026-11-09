import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { PromoCanon, PromoConnection, PromoDraft, PromoPlan, PromoQA, PromoSources, PROMO_QA, prepareCharacterPromo, promoSnapshotDigest } from './character-promo-delivery'
import { readCharacterPromoApproval } from './character-promo-store'

// Dormant read-only adapter: no route, credentials, connection refresh, writes or dispatch.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SHA=/^[a-f0-9]{64}$/
const MAX_BYTES=35*1024*1024
const DRAFT='id,character_id,status,spoken_script,visual_brief,duration_seconds,intended_channel,actual_social_account,video_asset_path,audio_asset_path,voice_approved_at,video_qa_approved_at,publication_approved_at,updated_at'
const PLAN='id,promo_id,character_id,network,account_id,scheduled_at,status,caption'
const QA='id,promo_id,video_sha256,check_name,result,evidence,reviewer_id,created_at'
export class PromoSourceError extends Error {
  constructor(readonly code:string,message:string) {super(message);this.name='PromoSourceError'}
}
function need(value:unknown,code:string,message:string):asserts value {if(!value)throw new PromoSourceError(code,message)}
async function readStep<T>(action:()=>PromiseLike<T>,code:string,message:string):Promise<T> {
  try {return await action()} catch {throw new PromoSourceError(code,message)}
}
function textField(row:Record<string,unknown>,key:string,code:string) {
  need(typeof row[key]==='string' && (row[key] as string).trim(),code,`Required source field missing: ${key}`)
  return row[key] as string
}
function object(value:unknown,code:string):Record<string,unknown> {
  need(value && typeof value==='object' && !Array.isArray(value),code,'Source object unavailable')
  return value as Record<string,unknown>
}
function stable(value:unknown):string {
  if(value===null || typeof value==='string' || typeof value==='boolean')return JSON.stringify(value)
  if(typeof value==='number' && Number.isFinite(value))return JSON.stringify(value)
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']'
  need(value && typeof value==='object','invalid_source_json','Source contains unsupported JSON')
  return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}'
}
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex')

/** Uses fields already consumed by concierge-canon and host-portraits, not static snapshots.
 * Hash ALL source character fields, including context and any exposed rights evidence.
 * Only portrait_url is excluded: glyph-live constructs that local presentation URL.
 */
export function normalizePromoCanon(value:unknown,characterId:string,checkedAt:string):PromoCanon {
  const source=object(value,'glyph_unavailable')
  need(source.live===true && Array.isArray(source.characters),'glyph_not_live','Live GLYPH character registry required')
  const matches=source.characters.filter(row=>row && typeof row==='object' && row.id===characterId)
  need(matches.length===1,'glyph_ambiguous_character','Exactly one current GLYPH character is required')
  const row=object(matches[0],'glyph_character_missing')
  textField(row,'canonical_context','glyph_context_missing')
  const asset=textField(row,'primary_asset_id','glyph_portrait_id_missing'),sha=textField(row,'sha256','glyph_portrait_hash_missing'),voice=textField(row,'voice_id','glyph_voice_missing')
  need(UUID.test(asset)&&SHA.test(sha),'glyph_portrait_invalid','Current GLYPH portrait ID/hash is invalid')
  need(row.rights_status==='approved','glyph_rights_unapproved','Current GLYPH rights are not approved')
  need(row.voice_status==='canonical','glyph_voice_uncanonical','Current GLYPH voice is not canonical')
  need(row.production_ready===true,'glyph_not_production_ready','Current GLYPH character is not production-ready')
  const evidence=Object.fromEntries(Object.entries(row).filter(([key])=>key!=='portrait_url'))
  const serialized=stable(evidence)
  need(serialized.length<=262144,'glyph_evidence_too_large','Canonical character evidence exceeds review limit')
  return {revision_sha256:digest(serialized),live:true,checked_at:checkedAt,character_id:characterId,primary_asset_id:asset,portrait_sha256:sha,voice_id:voice,rights_status:'approved',voice_status:'canonical',production_ready:true}
}
export function normalizePromoConnection(value:unknown,checkedAt:string):PromoConnection {
  const rows=Array.isArray(value)?value:object(value,'metricool_unavailable').data
  need(Array.isArray(rows),'metricool_invalid_brands','Provider brand registry missing')
  const matches=rows.filter(row=>row && typeof row==='object' && String(row.id)==='5373515')
  need(matches.length===1,'metricool_ambiguous_brand','Exactly one verified Tru Skool brand is required')
  const brand=matches[0],networks=object(brand.networksData,'metricool_accounts_missing')
  need(String(brand.userId)==='4174093' && networks.facebookData==='146219355471397' && networks.threadsData==='truskoolcorp','metricool_mapping_changed','Verified Tru Skool user or account mapping changed')
  const timezone=textField(brand,'timezone','metricool_timezone_missing')
  try {new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(0)} catch {throw new PromoSourceError('metricool_timezone_invalid','Provider timezone is invalid')}
  return {verified:true,checked_at:checkedAt,user_id:'4174093',brand_id:'5373515',timezone,accounts:[{network:'facebook',account_id:'146219355471397'},{network:'threads',account_id:'truskoolcorp'}]}
}

export type PromoSourceClient=Pick<SupabaseClient,'from'|'rpc'|'storage'>
export type PromoSourceDependencies={db:PromoSourceClient;readGlyph():Promise<unknown>;readMetricoolBrands():Promise<unknown>;now():number}
function date(value:unknown) {return typeof value==='string' && Number.isFinite(Date.parse(value))}
function normalizedDate(value:unknown,code:string):string {need(date(value),code,'Source timestamp is invalid');return new Date(value as string).toISOString()}
async function records(db:PromoSourceClient,planId:string) {
  const p=await readStep(()=>db.from('cs_character_promo_delivery_plans').select(PLAN).eq('id',planId).maybeSingle(),'plan_read_failed','Delivery plan read failed')
  need(!p.error && p.data,'plan_unavailable','Delivery plan unavailable; caption column requires the reviewed ledger proposal')
  const plan=object(p.data,'plan_invalid')
  need(plan.id===planId && typeof plan.promo_id==='string' && UUID.test(plan.promo_id),'plan_identity_invalid','Plan identity is invalid')
  const d=await readStep(()=>db.from('cs_character_promo_drafts').select(DRAFT).eq('id',plan.promo_id as string).maybeSingle(),'draft_read_failed','Promotion draft read failed')
  need(!d.error && d.data,'draft_unavailable','Promotion draft unavailable')
  const draft=object(d.data,'draft_invalid')
  need(draft.id===plan.promo_id && draft.character_id==='keith' && plan.character_id===draft.character_id,'draft_identity_invalid','Plan does not belong to the mapped Keith promotion')
  const path=textField(draft,'video_asset_path','media_missing')
  const match=path.match(/^character-promos\/keith\/([a-f0-9-]{36})\/([a-f0-9]{64})\.mp4$/)
  need(match && match[1]===draft.id,'media_path_invalid','Finalized private media path must match this exact promotion and SHA-256')
  const qa=await readStep(()=>db.from('cs_character_promo_qa_checks').select(QA).eq('promo_id',plan.promo_id as string).eq('video_sha256',match[2]).limit(9),'qa_read_failed','Current-video QA read failed')
  need(!qa.error && Array.isArray(qa.data),'qa_unavailable','Current-video QA observations unavailable')
  need(qa.data.length<=8,'qa_ambiguous','Too many current-video QA observations')
  for(const row of qa.data)need(row.promo_id===draft.id && row.video_sha256===match[2] && UUID.test(row.id) && (PROMO_QA as readonly string[]).includes(row.check_name) && ['pass','fail','needs_review'].includes(row.result) && typeof row.evidence==='string' && (row.reviewer_id===null || UUID.test(row.reviewer_id)) && date(row.created_at),'qa_invalid','Incomplete or foreign QA observation')
  // Preserve exact DB facts for consistency checks; normalize timestamp spelling only for engine snapshots.
  return {raw:{draft,plan,qa:[...qa.data].sort((a,b)=>String(a.id).localeCompare(String(b.id)))},hash:match[2],path}
}

/** Reads only. Missing content approvals can be returned for review, never filled in. */
export async function readCharacterPromoSources(planId:string,deps:PromoSourceDependencies):Promise<PromoSources> {
  need(UUID.test(planId),'plan_id_invalid','Valid delivery plan UUID required')
  const first=await records(deps.db,planId)
  const file=await readStep(()=>deps.db.storage.from('cafe-sativa-content').download(first.path),'media_read_failed','Private approved MP4 download failed')
  need(!file.error && file.data,'media_unavailable','Private approved MP4 unavailable')
  need(Number.isSafeInteger(file.data.size) && file.data.size>=16 && file.data.size<=MAX_BYTES,'media_size_invalid','Private MP4 exceeds supported size or is empty')
  const bytes=new Uint8Array(await readStep(()=>file.data!.arrayBuffer(),'media_bytes_failed','Private MP4 byte read failed'))
  need(bytes.length===file.data.size && bytes.length<=MAX_BYTES && Buffer.from(bytes).toString('ascii',4,8)==='ftyp','media_integrity_invalid','Private MP4 bytes failed size/header verification')
  need(digest(bytes)===first.hash,'media_hash_changed','Private MP4 bytes do not match the finalized SHA-256')
  const canonStart=new Date(deps.now()).toISOString()
  let glyph:unknown
  try {glyph=await deps.readGlyph()} catch {throw new PromoSourceError('glyph_read_failed','Live GLYPH source read failed')}
  const canon=normalizePromoCanon(glyph,'keith',canonStart)
  const connectionStart=new Date(deps.now()).toISOString()
  let brands:unknown
  try {brands=await deps.readMetricoolBrands()} catch {throw new PromoSourceError('metricool_read_failed','Verified provider destination read failed')}
  const connection=normalizePromoConnection(brands,connectionStart)
  const last=await records(deps.db,planId)
  need(stable(first.raw)===stable(last.raw),'sources_changed','Draft, plan or QA changed during review; reload required')
  need([canonStart,connectionStart].every(t=>deps.now()>=Date.parse(t) && deps.now()-Date.parse(t)<=60000),'external_evidence_stale','Live canonical or destination evidence expired during source reads')
  const d=last.raw.draft,p=last.raw.plan
  for(const field of ['status','spoken_script','visual_brief','intended_channel'])textField(d,field,'draft_field_missing')
  need(Number.isInteger(d.duration_seconds),'draft_duration_invalid','Draft duration missing or invalid')
  need(typeof p.caption==='string','plan_caption_missing','Exact review caption has not been stored')
  for(const field of ['network','status'])textField(p,field,'plan_field_missing')
  for(const field of ['audio_asset_path','actual_social_account','voice_approved_at','video_qa_approved_at','publication_approved_at'])need(d[field]===null || typeof d[field]==='string','draft_field_missing',`Required draft field missing: ${field}`)
  const draft={...d,updated_at:normalizedDate(d.updated_at,'draft_revision_invalid')} as PromoDraft
  for(const field of ['voice_approved_at','video_qa_approved_at','publication_approved_at'] as const)if(draft[field]!==null)draft[field]=normalizedDate(draft[field],'approval_timestamp_invalid')
  const plan={...p,scheduled_at:normalizedDate(p.scheduled_at,'schedule_invalid')} as PromoPlan
  return {draft,plan,qa:last.raw.qa as PromoQA[],canon,connection,videoBytes:bytes}
}
export async function readApprovedCharacterPromo(planId:string,deps:PromoSourceDependencies) {
  const sources=await readCharacterPromoSources(planId,deps)
  const approval=await readStep(()=>readCharacterPromoApproval(deps.db,planId),'delivery_approval_read_failed','Exact delivery approval read failed')
  need(approval,'delivery_approval_missing','Exact delivery approval is missing, invalidated or no longer authorized')
  const snapshot=prepareCharacterPromo(sources,deps.now())
  need(Date.parse(approval.approvedAt)<=deps.now() && Date.parse(approval.approvedAt)>=Math.max(...Object.values(snapshot.approvals).map(Date.parse)),'delivery_approval_timestamp_invalid','Delivery approval timestamp is not current final-approval evidence')
  need(promoSnapshotDigest(snapshot)===approval.digest && promoSnapshotDigest(approval.snapshot)===approval.digest,'delivery_approval_stale','Current sources differ from the explicit delivery approval')
  return {sources,approval}
}
