import { createHash } from 'node:crypto'
import { characterPromoAudioStatus } from './character-promo-audio'

// LOCAL PROPOSAL ONLY: dormant database/provider adapters exist; no runtime caller or route.
export const CHARACTER_PROMO_DELIVERY_ENABLED = false
export const PROMO_QA = ['mp4_integrity','canonical_likeness','canonical_speech','lip_sync','visual_text','rights','duration','brand_safety'] as const
const ACCOUNTS = { facebook: '146219355471397', threads: 'truskoolcorp' } as const
export type PromoNetwork = keyof typeof ACCOUNTS
export type PromoDraft = {
  id: string; character_id: string; status: string; spoken_script: string; visual_brief: string
  duration_seconds: number; intended_channel: string; actual_social_account: string | null
  video_asset_path: string | null; audio_asset_path: string | null
  voice_approved_at: string | null; video_qa_approved_at: string | null; publication_approved_at: string | null
  updated_at: string
}
export type PromoPlan = { id: string; promo_id: string; character_id: string; network: string; account_id: string | null; scheduled_at: string; status: string; caption: string }
export type PromoQA = { id: string; reviewer_id: string | null; evidence: string; created_at: string; promo_id: string; video_sha256: string; check_name: string; result: string }
export type PromoCanon = { revision_sha256: string; live: boolean; checked_at: string; character_id: string; primary_asset_id: string; portrait_sha256: string; voice_id: string; rights_status: string; voice_status: string; production_ready: boolean }
export type PromoConnection = { verified: boolean; checked_at: string; user_id: string; brand_id: string; timezone: string; accounts: { network: string; account_id: string }[] }
export type PromoSources = { draft: PromoDraft; plan: PromoPlan; qa: PromoQA[]; canon: PromoCanon; connection: PromoConnection; videoBytes: Uint8Array }
export type PromoSnapshot = {
  qa: PromoQA[]; version: 1; planId: string; promoId: string; characterId: string; draftRevision: string
  script: string; visualBrief: string; durationSeconds: number; audioPath: string | null
  videoPath: string; videoSha256: string; videoBytes: number
  canon: { revisionSha256: string; assetId: string; portraitSha256: string; voiceId: string; rightsStatus: 'approved'; voiceStatus: 'canonical'; productionReady: true }
  approvals: { voice: string; video: string; publication: string }
  caption: string; scheduledAt: string; network: PromoNetwork; accountId: string
  brandId: '5373515'; userId: '4174093'; timezone: string
}
export type PromoApproval = { snapshot: PromoSnapshot; digest: string; approvedBy: string; approvedAt: string; revokedAt: string | null }
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
// Sorted object keys make database JSON key ordering irrelevant. No caller-provided hashes trusted.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}'
  return JSON.stringify(value)
}
export const promoSnapshotDigest = (snapshot: PromoSnapshot) => sha(canonical(snapshot))
function demand(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason) }
function validDate(value: string | null, now: number) { return !!value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now }
function fresh(value: string, now: number) { return validDate(value,now) && now-Date.parse(value)<=60_000 }

/** Builds a review candidate, NEVER an approval. Inputs must come from trusted server reads. */
export function prepareCharacterPromo(s: PromoSources, now = Date.now()): PromoSnapshot {
  const {draft:d, plan:p, canon:c, connection:x} = s
  demand(Number.isFinite(now), 'Invalid clock')
  demand(d.id && p.id && p.promo_id===d.id && p.character_id===d.character_id, 'Plan ownership mismatch')
  // No Café or dedicated-persona account has been verified for this integration.
  demand(d.character_id==='keith' && d.intended_channel==='truskoolcorp_metricool_brand_5373515', 'No authorized persona destination mapping')
  demand(p.network==='facebook' || p.network==='threads', 'Unsupported destination')
  const network=p.network as PromoNetwork
  demand(p.account_id===ACCOUNTS[network] && d.actual_social_account==='metricool-brand:5373515', 'Exact account mapping required')
  demand(p.status==='ready_for_delivery' && d.status==='script_approved', 'Plan or script not cleared')
  demand(d.spoken_script.trim() && d.visual_brief.trim() && d.duration_seconds>=8 && d.duration_seconds<=45, 'Invalid reviewed content')
  demand(validDate(d.updated_at,now), 'Invalid draft revision')
  demand([d.voice_approved_at,d.video_qa_approved_at,d.publication_approved_at].every(v=>validDate(v,now)), 'Explicit final approvals required')
  demand(p.caption.trim() && Array.from(p.caption).length<=500, 'Caption required, maximum 500 characters')
  demand(Number.isFinite(Date.parse(p.scheduled_at)) && Date.parse(p.scheduled_at)>now+60_000 && new Date(p.scheduled_at).toISOString()===p.scheduled_at, 'Exact future UTC schedule required')
  demand(/^[a-f0-9]{64}$/.test(c.revision_sha256) && c.live && fresh(c.checked_at,now) && c.character_id===d.character_id && c.rights_status==='approved' && c.voice_status==='canonical' && c.production_ready && c.primary_asset_id && /^[a-f0-9]{64}$/.test(c.portrait_sha256) && c.voice_id, 'Fresh live rights and canonical reference required')
  demand(x.verified && fresh(x.checked_at,now) && x.brand_id==='5373515' && x.user_id==='4174093', 'Fresh verified connection required')
  demand(x.accounts.length===2 && Object.entries(ACCOUNTS).every(([n,a])=>x.accounts.filter(v=>v.network===n && v.account_id===a).length===1), 'Connection account mapping changed')
  demand(x.timezone.trim(), 'Timezone missing')
  try { new Intl.DateTimeFormat('en-US',{timeZone:x.timezone}).format(now) } catch { throw new Error('Invalid timezone') }
  const videoSha256=sha(s.videoBytes)
  demand(d.video_asset_path===`character-promos/${d.character_id}/${d.id}/${videoSha256}.mp4`, 'Canonical media path or actual bytes changed')
  demand(s.videoBytes.byteLength>=16 && s.videoBytes.byteLength<=35*1024*1024 && Buffer.from(s.videoBytes).toString('ascii',4,8)==='ftyp', 'Invalid MP4 bytes')
  for(const check of PROMO_QA) {
    const rows=s.qa.filter(q=>q.promo_id===d.id && q.video_sha256===videoSha256 && q.check_name===check)
    demand(rows.length===1 && rows[0].result==='pass', `Current-video QA required: ${check}`)
  }
  demand(characterPromoAudioStatus(d,s.qa).ready, 'Final voice approval and speech evidence required')
  return {qa:s.qa.filter(q=>q.promo_id===d.id && q.video_sha256===videoSha256 && (PROMO_QA as readonly string[]).includes(q.check_name)).map(q=>({...q})).sort((a,b)=>a.check_name.localeCompare(b.check_name)),version:1,planId:p.id,promoId:d.id,characterId:d.character_id,draftRevision:d.updated_at,script:d.spoken_script,visualBrief:d.visual_brief,durationSeconds:d.duration_seconds,audioPath:d.audio_asset_path,videoPath:d.video_asset_path!,videoSha256,videoBytes:s.videoBytes.byteLength,canon:{revisionSha256:c.revision_sha256,assetId:c.primary_asset_id,portraitSha256:c.portrait_sha256,voiceId:c.voice_id,rightsStatus:'approved',voiceStatus:'canonical',productionReady:true},approvals:{voice:d.voice_approved_at!,video:d.video_qa_approved_at!,publication:d.publication_approved_at!},caption:p.caption,scheduledAt:p.scheduled_at,network,accountId:p.account_id!,brandId:'5373515',userId:'4174093',timezone:x.timezone}
}

export type PromoReceipt = { providerId: string; providerUuid: string; snapshotDigest: string; videoSha256: string; network: string; accountId: string; brandId: string; userId: string; caption: string; scheduledAt: string; timezone: string; state: 'scheduled' }
export interface PromoDeliveryStore {
  // Must atomically lock/revalidate sources + exact approval and insert UNIQUE(plan_id).
  // Never expire/reclaim claims. A crash at any point requires manual reconciliation.
  claim(input: {planId: string; digest: string; approval: PromoApproval}): Promise<string | null>
  // CAS on plan+claim token+submitting; true only when one durable row was changed.
  finish(input: {planId: string; token: string; state: 'scheduled' | 'submission_unknown'; receipt: PromoReceipt | null}): Promise<boolean>
}
export interface PromoDeliveryDependencies {
  readCurrent(): Promise<{sources: PromoSources; approval: PromoApproval}>
  store: PromoDeliveryStore
  // Upload/share and create exactly ONCE, only after durable claim. No derivatives:
  // this adapter must transmit these exact verified bytes and exact single destination.
  // No retry middleware. Return receipt after explicit provider readback, not inference.
  submit(snapshot: PromoSnapshot, bytes: Uint8Array, revalidate: () => Promise<void>): Promise<PromoReceipt>
  now(): number
}
function receiptMatches(r: PromoReceipt,s: PromoSnapshot,digest: string) {
  return r && r.state==='scheduled' && !!r.providerId && !!r.providerUuid && r.snapshotDigest===digest && r.videoSha256===s.videoSha256 && r.network===s.network && r.accountId===s.accountId && r.brandId===s.brandId && r.userId===s.userId && r.caption===s.caption && r.scheduledAt===s.scheduledAt && r.timezone===s.timezone
}
/** Testable engine, dormant until a reviewed atomic store and owner approval UI exist. */
export async function executeCharacterPromo(deps: PromoDeliveryDependencies, options: {enabled?: boolean} = {}) {
  if(options.enabled!==true) return {status:'disabled' as const}
  const {sources,approval}=await deps.readCurrent()
  // Own the bytes across awaits; upstream mutation must not change what is transmitted.
  const bytes=Uint8Array.from(sources.videoBytes)
  const snapshot=prepareCharacterPromo({...sources,videoBytes:bytes},deps.now())
  const digest=promoSnapshotDigest(snapshot)
  demand(approval && approval.approvedBy?.trim() && validDate(approval.approvedAt,deps.now()) && !approval.revokedAt && approval.digest===digest && promoSnapshotDigest(approval.snapshot)===digest, 'Exact owner-approved snapshot required')
  demand(Date.parse(approval.approvedAt)>=Math.max(...Object.values(snapshot.approvals).map(Date.parse)), 'Delivery approval predates final content approval')
  const token=await deps.store.claim({planId:snapshot.planId,digest,approval})
  if(!token) return {status:'already_claimed_or_stale' as const}
  try {
    // Clock drift during claim must never result in an immediate/past-due post.
    demand(Date.parse(snapshot.scheduledAt)>deps.now()+60_000, 'Schedule expired during claim')
    // Re-read after the durable claim. DB guards freeze SQL sources; this also
    // refreshes remote canon/connection evidence before any private URL transmission.
    const revalidate=async () => {
      const latest=await deps.readCurrent()
      const current=prepareCharacterPromo(latest.sources,deps.now())
      demand(promoSnapshotDigest(current)===digest && latest.approval.digest===digest && !latest.approval.revokedAt && latest.approval.approvedBy===approval.approvedBy && latest.approval.approvedAt===approval.approvedAt, 'Approval or live sources changed after claim')
    }
    await revalidate()
    const receipt=await deps.submit(snapshot,bytes,revalidate)
    demand(receiptMatches(receipt,snapshot,digest), 'Ambiguous scheduling receipt')
    demand(await deps.store.finish({planId:snapshot.planId,token,state:'scheduled',receipt}), 'Receipt was not persisted')
    return {status:'scheduled' as const, publicationConfirmed:false, receipt}
  } catch {
    // A failed finish still leaves a durable submitting claim. Never auto-retry either.
    try { await deps.store.finish({planId:snapshot.planId,token,state:'submission_unknown',receipt:null}) } catch { /* manual reconciliation */ }
    return {status:'submission_unknown' as const, publicationConfirmed:false}
  }
}
