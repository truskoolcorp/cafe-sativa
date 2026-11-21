import {createHash} from 'node:crypto'
/** Bounded adapter with no self-dispatch, network, RPC, authorization or retry.
 * Production use is default-off and requires a separately approved durable
 * sink; both adapter and sink must reject the existing frozen attempt. */
export const TEXT_RECEIPT_MODEL='claude-haiku-4-5-20251001' as const
const reasons=['end_turn','max_tokens','stop_sequence','tool_use','pause_turn','refusal','model_context_window_exceeded'] as const
export type TextReceiptEvidence={providerId:string;requestId:string|null;model:typeof TEXT_RECEIPT_MODEL;stopReason:typeof reasons[number];inputTokens:number;outputTokens:number;responseSha256:string}
export type TextReceiptDiagnostic='frozen_attempt'|'attempt_invalid'|'attempt_consumed'|'cancelled_before_provider'|'provider_unconfirmed'|'receipt_invalid'|'receipt_persistence_unconfirmed'|'cancelled_after_receipt'
export class TextReceiptError extends Error{
 constructor(readonly code:TextReceiptDiagnostic){super(code);this.name='TextReceiptError'}
}
const invalid=():never=>{throw new TextReceiptError('receipt_invalid')}
/** content_json_v1: SHA256 of UTF8 deterministic JSON content array (not
 * raw HTTP bytes). Object keys sorted by UTF16 ordering, array order retained,
 * JSON string/number encoding; no whitespace. Only JSON data is supported.
 * Bound output to 256KiB, depth 64 and 32768 visited values. Unsupported,
 * cyclic or oversized content is held as receipt_invalid, without a receipt. */
export function contentJson(value:unknown):string{
 if(!Array.isArray(value))return invalid()
 const active=new Set<object>();let bytes=0,nodes=0
 const emit=(s:string)=>{bytes+=Buffer.byteLength(s,'utf8');if(bytes>262144)return invalid();return s}
 const walk=(v:unknown,depth:number):string=>{
  if(depth>64||++nodes>32768)return invalid()
  if(v===null)return emit('null')
  if(typeof v==='string'){if(v.length>262144)return invalid();return emit(JSON.stringify(v))}
  if(typeof v==='boolean')return emit(v?'true':'false')
  if(typeof v==='number'){if(!Number.isFinite(v))return invalid();return emit(JSON.stringify(v))}
  if(typeof v!=='object'||active.has(v))return invalid()
  const proto=Object.getPrototypeOf(v)
  if(!Array.isArray(v)&&proto!==null&&Object.getPrototypeOf(proto)!==null)return invalid()
  if(Object.getOwnPropertySymbols(v).length)return invalid()
  const descriptors=Object.getOwnPropertyDescriptors(v),keys=Object.keys(descriptors)
  if(keys.length>32768)return invalid()
  active.add(v)
  let result:string
  if(Array.isArray(v)){
   if(v.length>32768||keys.length!==v.length+1)return invalid()
   result=emit('[')
   for(let i=0;i<v.length;i++){
    const d=descriptors[String(i)];if(!d||!('value'in d)||!d.enumerable)return invalid()
    if(i)result+=emit(',');result+=walk(d.value,depth+1)
   }
   result+=emit(']')
  }else{
   result=emit('{')
   for(const [i,k] of keys.sort().entries()){
    const d=descriptors[k];if(!('value'in d)||!d.enumerable||k.length>262144)return invalid()
    if(i)result+=emit(',');result+=emit(JSON.stringify(k))+emit(':')+walk(d.value,depth+1)
   }
   result+=emit('}')
  }
  active.delete(v);return result
 }
 return walk(value,0)
}
/** Only explicit metadata leaves this function. Never attach raw response,
 * arbitrary provider exceptions, prompt, headers or secret-bearing cause. */
export function textReceiptEvidence(raw:unknown):TextReceiptEvidence{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalid()
  const r=raw as Record<string,unknown>,usage=r.usage as Record<string,unknown>|undefined
  if(typeof r.id!=='string'||!/^msg_[A-Za-z0-9]{8,196}$/.test(r.id)||r.model!==TEXT_RECEIPT_MODEL||typeof r.stop_reason!=='string'||!(reasons as readonly string[]).includes(r.stop_reason))return invalid()
  const requestId=r._request_id===undefined||r._request_id===null?null:r._request_id
  if(requestId!==null&&(typeof requestId!=='string'||!/^req_[A-Za-z0-9]{8,196}$/.test(requestId)))return invalid()
  if(!usage||!Number.isSafeInteger(usage.input_tokens)||Number(usage.input_tokens)<0||Number(usage.input_tokens)>200000||!Number.isSafeInteger(usage.output_tokens)||Number(usage.output_tokens)<0||Number(usage.output_tokens)>1024)return invalid()
  const content=contentJson(r.content)
  return {providerId:r.id,requestId:requestId as string|null,model:TEXT_RECEIPT_MODEL,stopReason:r.stop_reason as TextReceiptEvidence['stopReason'],inputTokens:Number(usage.input_tokens),outputTokens:Number(usage.output_tokens),responseSha256:createHash('sha256').update(content,'utf8').digest('hex')}
 }catch{return invalid()}
}
/** Persist receipt metadata before returning the response to an editorial
 * parser. Unknown sink outcome never permits parsing, another call or retry.
 * The caller must join whenSettled before disposing its hosted operation. */
export function createTextReceiptCompletion<Request>(d:{attemptKey:string;complete(request:Request,signal:AbortSignal,dispatchGuard:()=>void):Promise<unknown>;persist(evidence:TextReceiptEvidence,signal:AbortSignal):Promise<boolean>;checkpoint?:(evidence:TextReceiptEvidence,contentJson:string,signal:AbortSignal)=>Promise<boolean>}){
 const attemptKey=d.attemptKey
 let used=false,work:Promise<unknown>|undefined
 return {
  complete(request:Request,signal:AbortSignal,dispatchGuard:()=>void):Promise<unknown>{
   if(used)return Promise.reject(new TextReceiptError('attempt_consumed'))
   used=true
   work=(async()=>{
    if(attemptKey==='daily:2026-11-16:zaria-solenne')throw new TextReceiptError('frozen_attempt')
    if(typeof attemptKey!=='string'||!/^daily:\d{4}-\d{2}-\d{2}:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(attemptKey)||attemptKey.length>200)throw new TextReceiptError('attempt_invalid')
    if(signal.aborted)throw new TextReceiptError('cancelled_before_provider')
    let response:unknown
    try{response=await d.complete(request,signal,dispatchGuard)}catch{throw new TextReceiptError('provider_unconfirmed')}
    const evidence=textReceiptEvidence(response)
    // Even a late response must go through the original bounded sink; never
    // detach persistence or manufacture a fresh signal after cancellation.
    if(d.checkpoint){
     try{const content=contentJson((response as Record<string,unknown>).content);if(createHash('sha256').update(content,'utf8').digest('hex')!==evidence.responseSha256||await d.checkpoint(evidence,content,signal)!==true)throw new TextReceiptError('receipt_persistence_unconfirmed')}
     catch{throw new TextReceiptError('receipt_persistence_unconfirmed')}
    }
    else{
     try{if(await d.persist(evidence,signal)!==true)throw new TextReceiptError('receipt_persistence_unconfirmed')}
     catch{throw new TextReceiptError('receipt_persistence_unconfirmed')}
    }
    if(signal.aborted)throw new TextReceiptError('cancelled_after_receipt')
    return response
   })()
   return work
  },
  async whenSettled(){used=true;if(work)await work.then(()=>undefined,()=>undefined)},
 }
}
