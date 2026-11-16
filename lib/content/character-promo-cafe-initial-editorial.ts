import {parseFreshEditorial,type ReplenishmentSource} from './character-production-replenishment'
import {normalizePromoDatabaseTime} from './character-promo-time'
/** Input must be the scoped persisted-source RPC result, never request/editor JSON.
 * SQL links its exact original text attempt through the immutable media snapshot. */
export function initialCafeEditorial(raw:unknown,plan:Record<string,unknown>,draft:Record<string,unknown>){
 const r=raw as {planId:string;draftId:string;network:string;accountId:string;scheduledAt:string;evidence:{draftId:string;slotDigest:string;snapshotSha256:string;textKey:string;textToken:string;textDigest:string;editorial:unknown;verifiedHandles:string[]}}
 const e=r?.evidence
 if(!e||r.planId!==plan.id||r.draftId!==draft.id||e.draftId!==draft.id||r.network!==plan.network||r.accountId!==plan.account_id||normalizePromoDatabaseTime(r.scheduledAt,true)!==normalizePromoDatabaseTime(plan.scheduled_at as string,true)||![e.slotDigest,e.snapshotSha256,e.textDigest].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||typeof e.textKey!=='string'||!/^daily:\d{4}-\d{2}-\d{2}:zaria-solenne$/.test(e.textKey)||typeof e.textToken!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(e.textToken)||!Array.isArray(e.verifiedHandles)||e.verifiedHandles.some(h=>typeof h!=='string'||! /^[a-zA-Z0-9_.]{1,30}$/.test(h)))throw Error('Exact persisted editorial required')
 // Existing parser consumes only verifiedHandles; other source fields are not
 // fabricated. A structural Pick keeps that dependency explicit.
 const x=parseFreshEditorial(e.editorial,{verifiedHandles:e.verifiedHandles} as ReplenishmentSource)
 if(x.spokenScript!==draft.spoken_script||x.caption!==plan.caption)throw Error('Saved editorial changed')
 return {facebookTitle:x.facebookTitle,hashtags:x.hashtags,collaborators:x.collaborators,evidenceRef:`saved-editorial:${e.textKey}:${e.textToken}:${e.textDigest}:${e.snapshotSha256}`}
}
