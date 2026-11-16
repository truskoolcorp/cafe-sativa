import 'server-only'
import {createProductionFetch} from './character-production-bounded-fetch'
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
 const pending=new Set<Promise<unknown>>(),networks=new Set<ReturnType<typeof createProductionFetch>>()
 let closing=false
 function track<T>(p:Promise<T>){pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p}
 const review=(input:CafeSemanticInput,signal:AbortSignal)=>{
  if(closing||signal.aborted||!key||!transport||!lease||lease.countingAuthorized!==true||lease.expiresAt<=Date.now()||!lease.accountEvidence||!lease.rateEvidence||!lease.tokenCeilingEvidence||!Number.isSafeInteger(lease.maxBillableInputTokens)||lease.maxBillableInputTokens<1||lease.maxBillableInputTokens>200000)return Promise.resolve(null)
  let client:Anthropic|undefined
  const sdk=(s:AbortSignal)=>{
   if(client)return client
   const network=createProductionFetch(s,(input,init)=>{
    s.throwIfAborted();init?.signal?.throwIfAborted()
    if(lease.expiresAt<=Date.now())throw Error('Semantic lease expired before dispatch')
    const url=new URL(input instanceof Request?input.url:String(input))
    if(url.origin!=='https://api.anthropic.com'||url.username||url.password||url.search||url.hash||!['/v1/messages','/v1/messages/count_tokens'].includes(url.pathname))throw Error('Unexpected semantic endpoint')
    return fetch(input,init)
   },10000)
   networks.add(network)
   client=new Anthropic({apiKey:key,maxRetries:0,timeout:10000,fetch:network.fetch})
   return client
  }
  return track(reviewCafePromotion(input,{
   reserve:({key:reviewKey,request},s)=>track((async()=>{
    s.throwIfAborted();if(lease.expiresAt<=Date.now())return false
    // Counts the complete exact system/messages/tool schema, not just caption characters.
    const {max_tokens,tool_choice,...countRequest}=request
    const tokens=await sdk(s).messages.countTokens({...countRequest,tool_choice} as Parameters<Anthropic['messages']['countTokens']>[0],{signal:s,maxRetries:0,timeout:10000})
    s.throwIfAborted();if(lease.expiresAt<=Date.now()||!Number.isSafeInteger(tokens.input_tokens)||tokens.input_tokens<=0||tokens.input_tokens>lease.maxBillableInputTokens)return false
    return transport.reserve(lease.budgetId,reviewKey,lease.maxBillableInputTokens,s)
   })()),recordReceipt:(receipt,s)=>track(transport.receipt(receipt,s)),complete:(request,options)=>track((async()=>{
    if(request.model!==CAFE_SEMANTIC_MODEL||request.max_tokens!==256||options.maxRetries!==0||lease.expiresAt<=Date.now())throw Error('Invalid semantic request')
    options.signal.throwIfAborted()
    return sdk(options.signal).messages.create(request as Parameters<Anthropic['messages']['create']>[0],options)
   })())
  },signal))
 }
 return Object.assign(review,{async whenSettled(){closing=true;while(pending.size)await Promise.allSettled([...pending]);await Promise.all(Array.from(networks,n=>n.whenSettled()))}})
}
