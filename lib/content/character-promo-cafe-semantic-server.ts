import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import {CAFE_SEMANTIC_MODEL,reviewCafePromotion,type CafeSemanticInput,type CafeSemanticDependencies} from './character-promo-cafe-semantic-review'
export type CafeSemanticBudgetTransport={
 /** Immutable reviewed account/rate/cap evidence. Null means no paid operation.
  * Counting endpoint permission/cost must be explicitly included in this lease. */
 lease:{budgetId:string;accountEvidence:string;rateEvidence:string;countingAuthorized:true;maxBillableInputTokens:number;tokenCeilingEvidence:string;expiresAt:number}|null
 reserve(budgetId:string,key:string,inputTokens:number,signal:AbortSignal):Promise<boolean>
 receipt(input:Parameters<CafeSemanticDependencies['recordReceipt']>[0],signal:AbortSignal):Promise<boolean>
}
/** Existing server key, SDK and no fallback. No I/O until review(). Private SQL
 * transport has no default implementation/grant; production remains denied. */
export function createCafeSemanticReviewer(transport:CafeSemanticBudgetTransport|null){
 const key=process.env.ANTHROPIC_API_KEY,lease=transport?.lease?structuredClone(transport.lease):null
 return (input:CafeSemanticInput,signal:AbortSignal)=>{
  if(!key||!transport||!lease||lease.countingAuthorized!==true||lease.expiresAt<=Date.now()||!lease.accountEvidence||!lease.rateEvidence||!lease.tokenCeilingEvidence||!Number.isSafeInteger(lease.maxBillableInputTokens)||lease.maxBillableInputTokens<1||lease.maxBillableInputTokens>200000)return Promise.resolve(null)
  const client=new Anthropic({apiKey:key,maxRetries:0,timeout:10000})
  return reviewCafePromotion(input,{
   reserve:async({key:reviewKey,request},s)=>{
    s.throwIfAborted();if(lease.expiresAt<=Date.now())return false
    // Counts the complete exact system/messages/tool schema, not just caption characters.
    const {max_tokens,tool_choice,...countRequest}=request
    const tokens=await client.messages.countTokens({...countRequest,tool_choice} as Parameters<typeof client.messages.countTokens>[0],{signal:s,maxRetries:0,timeout:10000})
    s.throwIfAborted();if(lease.expiresAt<=Date.now()||!Number.isSafeInteger(tokens.input_tokens)||tokens.input_tokens<=0||tokens.input_tokens>lease.maxBillableInputTokens)return false
    return transport.reserve(lease.budgetId,reviewKey,lease.maxBillableInputTokens,s)
   },recordReceipt:(receipt,s)=>transport.receipt(receipt,s),complete:async(request,options)=>{
    if(request.model!==CAFE_SEMANTIC_MODEL||request.max_tokens!==256||options.maxRetries!==0||lease.expiresAt<=Date.now())throw Error('Invalid semantic request')
    options.signal.throwIfAborted()
    return client.messages.create(request as Parameters<typeof client.messages.create>[0],options)
   }
  },signal)
 }
}
