'use strict'
const {replicateBatch}=require('./replicate-batch.cjs')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
/**
 * Long-running supervised runner: requires trusted adapters and an explicit
 * sandbox-only opt-in; never starts from import and never connects production.
 * Failure retries from the destination's durable checkpoint. One worker instance
 * per target stream must be enforced at the deployment layer; the destination
 * SQL serializes checkpoint writes and rejects out-of-order/changed replays.
 */
async function supervise(source,destination,{stream='cafe-sativa',limit=25,
 idleMs=2000,maxBackoffMs=30000,signal,sleepFn=sleep,onCycle=()=>{}}={}) {
 if(process.env.CS_REPLICATION_SANDBOX_ENABLED!=='true')throw Error('replication worker disabled')
 if(!stream.startsWith('isolated-'))throw Error('production streams forbidden in sandbox')
 let backoff=idleMs,cycles=0
 while(!signal?.aborted){
  try{
   const result=await replicateBatch(source,destination,{stream,limit})
   cycles++
   onCycle({ok:true,...result})
   backoff=idleMs
   if(signal?.aborted)break
   await sleepFn(result.applied?0:idleMs)
  }catch(error){
   cycles++
   onCycle({ok:false,error:error instanceof Error?error.message:'unknown'})
   if(signal?.aborted)break
   await sleepFn(backoff)
   backoff=Math.min(maxBackoffMs,Math.max(1,backoff*2))
  }
 }
 return {stopped:true,cycles}
}
module.exports={supervise}
