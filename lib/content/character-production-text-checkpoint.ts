import {parseFreshEditorial,replenishmentDigest,type ReplenishmentSource} from './character-production-replenishment'
import {textReceiptEvidence,contentJson,type TextReceiptEvidence} from './character-production-text-receipt-evidence'
export const CHECKPOINT_PARSER_VERSION='fresh-editorial-v1-zaria250' as const
export type TextCheckpointIdentity={key:string;token:string;sourceDigest:string}
export type TextCheckpoint=TextCheckpointIdentity&{evidence:TextReceiptEvidence;contentJson:string}
const fail=():never=>{throw Error('checkpoint_unconfirmed')}
export function validateCheckpointIdentity(i:TextCheckpointIdentity):void{
 if(!i||typeof i.key!=='string'||i.key==='daily:2026-11-16:zaria-solenne'||!/^daily:\d{4}-\d{2}-\d{2}:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(i.key)||i.key.length>200||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(i.token)||! /^[a-f0-9]{64}$/.test(i.sourceDigest))fail()
}
/** Local reconstruction, never new generation, save, promotion or authority.
 * Metadata is app evidence, not cryptographically authenticated provider proof.
 * Private content must not be logged or included in exception messages. */
export function readTextCheckpoint(expected:TextCheckpointIdentity,raw:unknown):unknown{
 try{
  validateCheckpointIdentity(expected)
  if(!raw||typeof raw!=='object')return fail()
  const c=raw as TextCheckpoint
  if(c.key!==expected.key||c.token!==expected.token||c.sourceDigest!==expected.sourceDigest||typeof c.contentJson!=='string'||Buffer.byteLength(c.contentJson,'utf8')>262144)return fail()
  const content=JSON.parse(c.contentJson)
  if(contentJson(content)!==c.contentJson)return fail()
  const e=c.evidence,response={id:e.providerId,_request_id:e.requestId,model:e.model,stop_reason:e.stopReason,usage:{input_tokens:e.inputTokens,output_tokens:e.outputTokens},content}
  const verified=textReceiptEvidence(response)
  if(Object.keys(verified).some(k=>verified[k as keyof TextReceiptEvidence]!==e[k as keyof TextReceiptEvidence]))return fail()
  return response
 }catch{return fail()}
}
/** Read-only stored-content reparse API. No complete/save/claim dependency is
 * available. Output remains unapproved; subsequent use requires a separately
 * authorized operation rechecking current canon, source and budget authority. */
export function createTextCheckpointReparser(d:{identity:TextCheckpointIdentity;read(signal:AbortSignal):Promise<unknown>}){
 const identity=structuredClone(d.identity);validateCheckpointIdentity(identity)
 let used=false
 return {async reparse(signal:AbortSignal){
  if(used)return fail();used=true
  try{
   signal.throwIfAborted();const raw=await d.read(signal);signal.throwIfAborted()
   if(!raw||typeof raw!=='object'||(raw as {parserVersion?:unknown}).parserVersion!==CHECKPOINT_PARSER_VERSION)return fail()
   const response=readTextCheckpoint(identity,raw) as {stop_reason:string;content:{type:string;text:string}[];usage:{input_tokens:number;output_tokens:number}}
   const source=structuredClone((raw as {sourceSnapshot:ReplenishmentSource}).sourceSnapshot)
   if(!source||replenishmentDigest({...source,observedAt:0})!==identity.sourceDigest||!Array.isArray(source.recentScripts)||!Array.isArray(source.verifiedHandles))return fail()
   if(response.stop_reason!=='end_turn'||response.content.length!==1||response.content[0].type!=='text'||typeof response.content[0].text!=='string'||response.content[0].text.length>10000||response.usage.input_tokens<1||response.usage.output_tokens<1)return fail()
   const output=parseFreshEditorial(JSON.parse(response.content[0].text),source)
   if(source.recentScripts.some(s=>s.trim().toLowerCase()===output.spokenScript.trim().toLowerCase()))return fail()
   signal.throwIfAborted()
   return {status:'unapproved_checkpoint' as const,output,parserVersion:CHECKPOINT_PARSER_VERSION,identity:structuredClone(identity),sourceDigest:identity.sourceDigest,historical:true as const,published:false as const,scheduled:false as const,currentAuthorityVerified:false as const}
  }catch{return fail()}
 }}
}
