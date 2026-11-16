import {createHash} from 'node:crypto'
import {parseFreshEditorial,replenishmentDigest,type ReplenishmentSource} from './character-production-replenishment'
import {validateIncludedSpeechOperation,type IncludedSpeechOperation} from './character-production-included-speech-operation'
export type FreshSpeechAuthority=Readonly<{reference:string;scope:'zaria-gallery-organic-fresh-speech';authorizedAt:number;expiresAt:number;revoked:boolean}>
export type SavedTextAttempt=Readonly<{key:string;token:string;state:string;source_digest:string;source_snapshot:ReplenishmentSource;output:unknown;provider_id:string;input_tokens:number;output_tokens:number}>
export type FreshSpeechCanon=Readonly<{character_id:string;revision_sha256:string;voice_id:string;portrait_sha256:string;primary_asset_id:string;rights_status:string;voice_status:string;production_ready:boolean}>
const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
/** Pure trusted-server binding. No read/write/provider I/O, no authorization from
 * previews or model output. Caller must load exact persisted text attempt and
 * current revocable owner scope, and revalidate this binding at actual dispatch.
 * Still only existing Zaria/voice/model scope, not generic persona activation. */
export function bindFreshIncludedSpeech(input:SavedTextAttempt,current:FreshSpeechCanon,authority:FreshSpeechAuthority,now:number):IncludedSpeechOperation{
 const a=structuredClone(input),canon=structuredClone(current),owner=structuredClone(authority)
 if(!Number.isSafeInteger(now)||!owner||owner.scope!=='zaria-gallery-organic-fresh-speech'||owner.revoked!==false||typeof owner.reference!=='string'||!/^[-A-Za-z0-9_.:]{1,200}$/.test(owner.reference)||!Number.isSafeInteger(owner.authorizedAt)||owner.authorizedAt>now||!Number.isSafeInteger(owner.expiresAt)||owner.expiresAt<=now)throw Error('Fresh speech authority unavailable')
 if(!a||!/^daily:\d{4}-\d{2}-\d{2}:zaria-solenne$/.test(a.key)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(a.token)||a.state!=='awaiting_audio_binding_and_qa'||typeof a.provider_id!=='string'||!a.provider_id.trim()||a.provider_id.length>200||!Number.isSafeInteger(a.input_tokens)||a.input_tokens<=0||!Number.isSafeInteger(a.output_tokens)||a.output_tokens<1||a.output_tokens>1024)throw Error('Persisted fresh text receipt required')
 const source=a.source_snapshot
 if(!source||source.characterId!=='zaria-solenne'||source.roomKey!=='gallery'||source.voiceId!=='5zneNR4v1Uw5AjIZ9Un4'||!Number.isSafeInteger(source.observedAt)||source.observedAt<owner.authorizedAt||source.observedAt>now||replenishmentDigest({...source,observedAt:0})!==a.source_digest)throw Error('Fresh text source mismatch')
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(source.observedAt)
 const part=(t:string)=>date.find(p=>p.type===t)!.value
 if(a.key!==`daily:${part('year')}-${part('month')}-${part('day')}:zaria-solenne`)throw Error('Fresh text cadence mismatch')
 if(canon.character_id!==source.characterId||canon.revision_sha256!==source.canonicalRevision||canon.voice_id!==source.voiceId||canon.portrait_sha256!==source.portraitSha256||canon.primary_asset_id!=='473df9fd-b48c-4f01-a89a-499de631b954'||canon.rights_status!=='approved'||canon.voice_status!=='canonical'||canon.production_ready!==true)throw Error('Live fresh speech canon mismatch')
 const script=parseFreshEditorial(a.output,source).spokenScript,scriptSha256=hash(script)
 // Stable identity excludes authority revision/expiry: renewing policy cannot
 // create a second paid attempt for the same persisted script occurrence.
 const key='fresh-zaria-'+hash(JSON.stringify([a.key,a.token,scriptSha256]))
 const result={key,authorizationRef:owner.reference,script,scriptSha256,characterId:source.characterId,voiceId:source.voiceId,modelId:'eleven_v4',canonicalRevision:source.canonicalRevision,portraitSha256:source.portraitSha256,expiresAt:owner.expiresAt,maxDurationSeconds:30}
 validateIncludedSpeechOperation(result) // preserves <=250 codepoints, no truncation
 return Object.freeze(result)
}
