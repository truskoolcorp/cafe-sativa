import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import {REPLENISHMENT_MODEL} from './character-production-replenishment'
/** Existing backend SDK/key/model; no I/O at construction and no fallback. The
 * caller MUST first acquire a separate text-generation budget claim. */
export function createReplenishmentCompletion(transportFactory?:(guard:()=>void)=>typeof fetch){
 return async(request:{model:typeof REPLENISHMENT_MODEL;max_tokens:1024;system:string;messages:{role:'user';content:string}[]},signal:AbortSignal,dispatchGuard:()=>void)=>{
  signal.throwIfAborted()
  if(!process.env.ANTHROPIC_API_KEY||request.model!==REPLENISHMENT_MODEL||request.max_tokens!==1024)throw Error('Text backend unavailable')
  let dispatched=false
  const guard=()=>{
   signal.throwIfAborted()
   if(typeof dispatchGuard!=='function'||dispatched)throw Error('Paid dispatch unavailable')
   dispatchGuard();signal.throwIfAborted();dispatched=true
  }
  // A tracking wrapper may prepare asynchronously too. It must run guard at
  // its final underlying fetch, not before entering that wrapper.
  const guardedFetch:typeof fetch=transportFactory?transportFactory(guard):(input,init)=>{
   init?.signal?.throwIfAborted();guard();return fetch(input,init)
  }
  return new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0,timeout:20000,fetch:guardedFetch}).messages.create(request,{signal,maxRetries:0,timeout:20000})
 }
}
