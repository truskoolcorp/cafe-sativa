import {performance} from 'node:perf_hooks'
export interface ProductionTimeBudget{requireRemaining(ms:number):void}
/** Admission only, not cancellation/receipt guarantee. Uses both clocks so a
 * wall-clock rollback cannot manufacture more paid-write time. */
export function createProductionTimeBudget(signal:AbortSignal,totalMs:number):ProductionTimeBudget {
 if(!Number.isSafeInteger(totalMs)||totalMs<1||totalMs>45000)throw Error('Invalid tick budget')
 const start=Date.now(),monotonic=performance.now()
 return Object.freeze({requireRemaining(ms:number){
  const now=Date.now(),elapsed=Math.max(now-start,performance.now()-monotonic)
  if(!Number.isSafeInteger(ms)||ms<1||ms>45000||signal.aborted||now<start||totalMs-elapsed<ms)throw Error('Insufficient remaining paid-write time')
 }})
}
