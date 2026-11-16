import 'server-only'
import {createTechnicalQaReceiptStore} from './character-production-technical-qa-receipt'
import {validateQaManifest} from './character-production-qa-bridge'
import {createHash} from 'node:crypto'
import {createSelectedBindingReader} from './character-production-binding-snapshot'
import {createFreshSpeechReceiptReader,type FreshReceiptStorage} from './character-production-fresh-speech-receipt-store'
import {createPrivateRenderedAudioSource,type PrivateAudioStorage} from './character-production-private-audio'
import {renderedAudioPath} from './character-production-rendered-audio'
import {createStreamingQaStorage} from './character-production-qa-storage'
import {evaluateTechnicalMedia} from './character-production-technical-media.mjs'
import type {SelectedItem} from './character-production-selected-session'
import type {ProductionRpc} from './character-production-store'
/** Trusted enrolled QA only. Must run after materialize and before ingest commits.
 * Optional typed technical observation persistence only; no final authority, URLs, synthesis or provider requests. */
export function createSelectedTechnicalQa(d:{rpc:ProductionRpc;storage:FreshReceiptStorage&PrivateAudioStorage&Parameters<typeof createStreamingQaStorage>[0];signal:AbortSignal;enabled:()=>boolean;origin:string;ffmpeg:string;ffprobe:string;persistTechnical?:boolean}){
 const persistence=d.persistTechnical===true?createTechnicalQaReceiptStore(d.rpc,d.signal,d.enabled):null
 const binding=createSelectedBindingReader(d),check=()=>{d.signal.throwIfAborted();if(!d.enabled())throw Error('Technical QA disabled')}
 let used=false,work:Promise<unknown>|undefined
 return {run(selected:SelectedItem){
  if(used)throw Error('Technical QA consumed');used=true
  const original=structuredClone(selected)
  const task=(async()=>{
   check();if(original.phase!=='qa')throw Error('Exact QA selection required')
   const b=await binding.read(original);check()
   const speech=b.snapshot.speech,a=b.snapshot.image.audio
   const receipt=createFreshSpeechReceiptReader({textAttemptKey:speech.textAttemptKey,textAttemptToken:speech.textAttemptToken,textSourceDigest:speech.textSourceDigest,scriptSha256:createHash('sha256').update(b.slot.script).digest('hex')},{storage:d.storage,signal:d.signal,enabled:d.enabled})
   const audio=createPrivateRenderedAudioSource(d.storage,d.origin,[a])
   try{
    const r=await receipt.recover();check()
    if(r.sourceScope.scopeId!==speech.scopeId||r.scriptSha256!==a.scriptSha256||r.key!==speech.key||r.claimSha256!==speech.claimSha256||r.receiptSha256!==speech.receiptSha256||r.audioSha256!==a.audioSha256||r.audioBytes!==a.audioBytes||r.voiceId!==a.voiceId||r.modelId!==a.voiceModel||r.requestId!==a.synthesisReceiptId)throw Error('Original audio receipt mismatch')
    const prep=await d.rpc.rpc('character_production_qa_prepare',{p_key:original.key,p_digest:original.digest});check()
    if(prep.error)throw Error('QA manifest unavailable')
    const m=validateQaManifest(prep.data,original.key,original.digest)
    if(m.state!=='copy'||m.characterId!==b.slot.characterId)throw Error('Exact original private QA video required')
    if(persistence){const prior=await persistence.recover(original,m.promoId,m.sha);check();if(prior){if((await binding.read(original)).snapshotSha256!==b.snapshotSha256)throw Error('Selection changed during recovery');if(prior.evidence.snapshotSha256!==b.snapshotSha256||prior.evidence.audioSha256!==a.audioSha256)throw Error('Original receipt changed');return {...prior,selected:original,snapshotSha256:b.snapshotSha256,promoId:m.promoId}}}
    const storage=createStreamingQaStorage(d.storage,15000),bucket=await storage.getBucket('character-production-private');check()
    if(bucket.error||bucket.data?.public!==false||bucket.data.id!=='character-production-private')throw Error('Private source unavailable')
    const video=await storage.from('character-production-private').download(m.sourcePath as string,m.bytes as number);check()
    if(video.error||!video.data||video.data.length!==m.bytes)throw Error('Original video unavailable')
    const originalAudio=await audio.read(renderedAudioPath(a),a.audioBytes,d.signal);check()
    if((await binding.read(original)).snapshotSha256!==b.snapshotSha256)throw Error('Selection changed')
    const result=await evaluateTechnicalMedia({video:video.data,videoSha256:m.sha,audio:originalAudio,audioSha256:a.audioSha256},{signal:d.signal,ffmpeg:d.ffmpeg,ffprobe:d.ffprobe,timeoutMs:35000});check()
    if((await binding.read(original)).snapshotSha256!==b.snapshotSha256)throw Error('Selection changed after evaluation')
    if(persistence){const saved=await persistence.record(original,m.promoId,m.expectedUpdatedAt,b.snapshotSha256,result);check();if(saved.evidence.snapshotSha256!==b.snapshotSha256||saved.evidence.audioSha256!==a.audioSha256)throw Error('Saved technical identity changed');return {...saved,selected:original,snapshotSha256:b.snapshotSha256,promoId:m.promoId}}
    return {selected:original,snapshotSha256:b.snapshotSha256,promoId:m.promoId,technical:result,recorded:false as const}
   }finally{const settled=await Promise.allSettled([receipt.whenSettled(),audio.whenSettled()]);if(settled.some(r=>r.status==='rejected'))throw Error('QA audio settlement failed')}
  })();work=task;return task
 },async whenSettled(){used=true;await work}}
}
