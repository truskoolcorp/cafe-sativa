import {createHash} from 'node:crypto'
import type {IncludedSpeechOperation} from './character-production-included-speech-operation'
export type FreshSpeechSourceScope=Readonly<{scopeId:string;textAttemptKey:string;textAttemptToken:string;textSourceDigest:string}>
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s)
/** Source scope is read from the private current-authority RPC, never inferred
 * from a new owner lease when collecting an earlier operation's receipt. */
export function verifyFreshSpeechSourceScope(operation:IncludedSpeechOperation,p:FreshSpeechSourceScope){
 if(!p||Object.keys(p).sort().join(',')!=='scopeId,textAttemptKey,textAttemptToken,textSourceDigest'||!uuid(p.scopeId)||!uuid(p.textAttemptToken)||!/^daily:\d{4}-\d{2}-\d{2}:zaria-solenne$/.test(p.textAttemptKey)||! /^[a-f0-9]{64}$/.test(p.textSourceDigest)||operation.characterId!=='zaria-solenne')throw Error('fresh_source_scope_unconfirmed')
 const key='fresh-zaria-'+createHash('sha256').update(JSON.stringify([p.textAttemptKey,p.textAttemptToken,operation.scriptSha256])).digest('hex')
 if(operation.key!==key)throw Error('fresh_occurrence_unconfirmed')
}
