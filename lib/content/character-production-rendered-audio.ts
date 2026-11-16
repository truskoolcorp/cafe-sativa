import {createHash} from 'node:crypto'
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex')
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/.test(v)
/** Trusted persisted receipt from separately authorized synthesis, never a caller
 * assertion or inferred voice mapping. No synthesis/provider calls in this file. */
export type RenderedAudioBinding=Readonly<{
 characterId:string;avatarId:string;voiceId:string;voiceModel:string;
 canonicalRevision:string;portraitSha256:string;scriptSha256:string;
 audioSha256:string;audioBytes:number;mime:'audio/mpeg'|'audio/wav';
 provider:'elevenlabs';synthesisReceiptId:string;
}>
export function renderedAudioDigest(b:RenderedAudioBinding){
 if(!b||b.provider!=='elevenlabs'||![b.characterId,b.avatarId,b.voiceId,b.voiceModel,b.synthesisReceiptId].every(id)||![b.canonicalRevision,b.portraitSha256,b.scriptSha256,b.audioSha256].every(hash)||!Number.isSafeInteger(b.audioBytes)||b.audioBytes<12||b.audioBytes>32*1024*1024||!['audio/mpeg','audio/wav'].includes(b.mime))throw Error('Invalid rendered audio binding')
 return sha(JSON.stringify(['rendered-audio-v1',b.characterId,b.avatarId,b.voiceId,b.voiceModel,b.canonicalRevision,b.portraitSha256,b.scriptSha256,b.audioSha256,b.audioBytes,b.mime,b.provider,b.synthesisReceiptId]))
}
export function renderedAudioPath(b:RenderedAudioBinding){renderedAudioDigest(b);return 'audio/'+b.audioSha256+(b.mime==='audio/mpeg'?'.mp3':'.wav')}
export function verifyRenderedAudio(b:RenderedAudioBinding,script:string,voiceId:string,bytes:Uint8Array){
 try{
  renderedAudioDigest(b)
  if(typeof script!=='string'||!script.trim()||script.length>5000||voiceId!==b.voiceId||sha(script)!==b.scriptSha256||!(bytes instanceof Uint8Array)||bytes.length!==b.audioBytes||sha(bytes)!==b.audioSha256)return false
  // Structural sniff is not voice recognition. Provenance must come from trusted
  // synthesis receipt; semantic/listening QA remains mandatory before publication.
  const ascii=(a:number,z:number)=>Buffer.from(bytes.subarray(a,z)).toString('ascii')
  return b.mime==='audio/wav'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE':ascii(0,3)==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0
 }catch{return false}
}
