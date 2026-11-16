import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import {REPLENISHMENT_MODEL} from './character-production-replenishment'
/** Existing backend SDK/key/model; no I/O at construction and no fallback. The
 * caller MUST first acquire a separate text-generation budget claim. */
export function createReplenishmentCompletion(){
 return async(request:{model:typeof REPLENISHMENT_MODEL;max_tokens:1024;system:string;messages:{role:'user';content:string}[]},signal:AbortSignal)=>{
  signal.throwIfAborted()
  if(!process.env.ANTHROPIC_API_KEY||request.model!==REPLENISHMENT_MODEL||request.max_tokens!==1024)throw Error('Text backend unavailable')
  return new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0,timeout:20000}).messages.create(request,{signal,maxRetries:0,timeout:20000})
 }
}
