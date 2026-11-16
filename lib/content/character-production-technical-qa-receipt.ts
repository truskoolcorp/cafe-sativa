import {createHash,randomUUID} from 'node:crypto'
import type {ProductionRpc} from './character-production-store'
import type {SelectedItem} from './character-production-selected-session'
import type {TechnicalMediaResult} from './character-production-technical-media.mjs'
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
/** Receipt evidence is native technical inspection, never an owner's visual
 * approval. A failed write is followed by at most one READ, never another write. */
export function createTechnicalQaReceiptStore(rpc:ProductionRpc,signal:AbortSignal,enabled:()=>boolean){
 const attempted=new Set<string>()
 const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('Technical receipt disabled')}
 async function read(item:SelectedItem){check();const r=await rpc.rpc('character_production_technical_qa_receipt',{p_enrollment:item.enrollmentId,p_token:item.selectionToken});check();if(r.error)throw Error('Technical receipt read unconfirmed');return r.data}
 function receipt(raw:unknown,promoId:string,videoSha:string,text?:string){
  const r=raw as {evidenceText:string;evidenceSha256:string;promoId:string;videoSha256:string}
  if(!r||Object.keys(r).sort().join(',')!=='evidenceSha256,evidenceText,promoId,videoSha256'||r.promoId!==promoId||r.videoSha256!==videoSha||typeof r.evidenceText!=='string'||r.evidenceText.length>16384||sha(r.evidenceText)!==r.evidenceSha256||text!==undefined&&r.evidenceText!==text)throw Error('Technical receipt mismatch')
  const evidence=JSON.parse(r.evidenceText)
  if(evidence.qaApproved!==false||evidence.publicationApproved!==false||evidence.videoSha256!==videoSha)throw Error('Technical receipt is not approval')
  return {receipt:r,evidence,recorded:true as const,qaApproved:false as const,publicationApproved:false as const}
 }
 return {async recover(item:SelectedItem,promoId:string,videoSha:string){const r=await read(item);return r===null?null:receipt(r,promoId,videoSha)},
  async record(item:SelectedItem,promoId:string,revision:string,snapshotSha256:string,result:TechnicalMediaResult){
   check();const key=item.enrollmentId+':'+item.selectionToken;if(attempted.has(key))throw Error('Technical write consumed; reconcile read-only');attempted.add(key);const evidence={version:1,videoSha256:result.videoSha256,audioSha256:result.audioSha256,snapshotSha256,actualDurationSeconds:result.actualDurationSeconds,audioDurationSeconds:result.audioDurationSeconds,decodedAudioIdentical:result.decodedAudioIdentical,pcmHashes:result.pcmHashes,checks:result.checks,qaApproved:false,publicationApproved:false,evaluator:{kind:result.assessorKind,version:result.assessorVersion,ffmpegSha256:result.binaries.ffmpeg.sha256,ffprobeSha256:result.binaries.ffprobe.sha256,ffmpegVersion:result.binaries.ffmpeg.version,ffprobeVersion:result.binaries.ffprobe.version},observedAt:new Date().toISOString()}
   const text=JSON.stringify(evidence),claimId=randomUUID();let claimed=false
   try{const c=await rpc.rpc('character_production_technical_qa_claim',{p_enrollment:item.enrollmentId,p_token:item.selectionToken,p_expected_updated_at:revision,p_claim:claimId});check();const v=c.data as {claimed?:unknown;claimId?:unknown;promoId?:unknown;videoSha256?:unknown};claimed=!c.error&&!!v&&v.claimed===true&&v.claimId===claimId&&v.promoId===promoId&&v.videoSha256===result.videoSha256}catch{check()}
   if(!claimed){const prior=await read(item);if(prior===null)throw Error('Technical mutation held; read-only reconciliation required');return receipt(prior,promoId,result.videoSha256)}
   let outcome:unknown
   try{const r=await rpc.rpc('character_production_technical_qa_record',{p_enrollment:item.enrollmentId,p_token:item.selectionToken,p_expected_updated_at:revision,p_claim:claimId,p_evidence:text});check();if(!r.error)outcome=r.data}catch{check()}
   if(outcome!==null&&outcome!==undefined)return receipt(outcome,promoId,result.videoSha256,text)
   const recovered=await read(item)
   if(recovered===null)throw Error('Technical write unconfirmed; read-only reconciliation required')
   return receipt(recovered,promoId,result.videoSha256,text)
  }}
}
