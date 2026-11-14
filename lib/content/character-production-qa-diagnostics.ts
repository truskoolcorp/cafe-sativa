/** Public-safe vocabulary only. Never return raw provider/SDK errors or URLs. */
export const qaPhases=['destination_preflight','prepare','source_policy','destination_policy','source_read','upload','destination_read','source_recheck','destination_recheck','commit'] as const
export const qaReasons=['authority_held','cancelled','operation_unconfirmed','persistence_unconfirmed','private_bucket_required','stream_capability_missing','stream_unavailable','deadline_exceeded','bytes_unavailable','bytes_mismatch','target_rejected','scope_rejected'] as const
export type QaReason=typeof qaReasons[number]
const messages:Readonly<Record<string,QaReason>>=Object.freeze({
 'QA persistence unconfirmed':'persistence_unconfirmed',
 'Private bucket required':'private_bucket_required','QA destination unavailable':'private_bucket_required','QA destination policy changed':'private_bucket_required','Unexpected private bucket':'private_bucket_required',
 'Streaming storage capability required':'stream_capability_missing',
 'Private stream unavailable':'stream_unavailable','Invalid private stream':'stream_unavailable',
 'Private storage operation unconfirmed':'deadline_exceeded','Private storage deadline exceeded':'deadline_exceeded','Private stream expired':'deadline_exceeded','Production body expired':'deadline_exceeded','Production request expired':'deadline_exceeded','Production request unconfirmed':'deadline_exceeded',
 'QA bytes unavailable':'bytes_unavailable','QA bytes mismatch':'bytes_mismatch','Private stream exceeds byte cap':'bytes_mismatch',
 'QA target not enrolled':'target_rejected','Invalid QA manifest':'target_rejected','QA commit identity rejected':'target_rejected',
 'QA scope rejected':'scope_rejected','Invalid QA job':'scope_rejected','Invalid private copy':'scope_rejected','Invalid private download':'scope_rejected',
 'QA cancelled':'cancelled','Production tick cancelled':'cancelled','Production request cancelled':'cancelled',
})
export function qaFailureReason(error:unknown):QaReason {
 // Only exact local constants map. Unknown SDK errors remain opaque.
 return error instanceof Error&&Object.prototype.hasOwnProperty.call(messages,error.message)?messages[error.message]:'operation_unconfirmed'
}
export function safeQaDiagnostic(value:unknown):{phase:typeof qaPhases[number];reason:QaReason;elapsedMs:number}|null {
 if(!value||typeof value!=='object')return null
 const d=value as {phase:unknown;reason:unknown;elapsedMs:unknown}
 if(!qaPhases.some(p=>p===d.phase)||!qaReasons.some(r=>r===d.reason)||typeof d.elapsedMs!=='number'||!Number.isInteger(d.elapsedMs)||d.elapsedMs<0||d.elapsedMs>60000)return null
 return {phase:d.phase as typeof qaPhases[number],reason:d.reason as QaReason,elapsedMs:d.elapsedMs}
}
export function qaHeldMessage(value:unknown):string {
 const d=safeQaDiagnostic(value)
 return 'Held. No approval was granted.'+(d?` Phase: ${d.phase}; reason: ${d.reason}; elapsed: ${d.elapsedMs} ms.`:'')+' Check the exact enrollment and QA draft before another action.'
}
