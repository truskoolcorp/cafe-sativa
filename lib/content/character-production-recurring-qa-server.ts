import type {createSelectedProductionSession} from './character-production-selected-session'
import 'server-only'
import {openPrivateQaSession} from './character-production-qa-worker-entry'
import {createRecurringPrivateQa} from './character-production-recurring-qa'
import type {CafeRecurringSession} from './character-production-recurring-entry'

/** Concrete private-QA adapter only. Uses the exact existing scoped SQL/private
 * Storage composition. No new credential, grant, route, cron or paid operation.
 * The database queue, never HTTP input, selects existing eligible bindings. */
export function createRecurringQaSession(signal:AbortSignal,selection?:Pick<ReturnType<typeof createSelectedProductionSession>,'readQa'>):CafeRecurringSession {
 let session:ReturnType<typeof openPrivateQaSession>|undefined
 let selected=false,read=false,used=false
 const enabled=()=>process.env.CS_CHARACTER_QA_BRIDGE_ENABLED==='true'
 const check=()=>{signal.throwIfAborted();if(!enabled())throw Error('QA disabled')}
 const runner=createRecurringPrivateQa({enabled,limit:1,open:()=>{
  signal.throwIfAborted()
  if(!session)throw Error('QA session not selected')
  return session
 }})
 return {
  async next(callSignal){
   signal.throwIfAborted();callSignal.throwIfAborted()
   if(callSignal!==signal||!enabled()||read)throw Error('QA selection unavailable')
   read=true;const backend=openPrivateQaSession(signal,check)
   session={...backend,rpc:{async rpc(name,args){
    check();const result=name==='character_production_qa_ready_slots'&&selection?{data:[await selection.readQa()],error:null}:await backend.rpc.rpc(name,args);check();return result
   }},bridge:{async ingest(key,digest){check();const result=await backend.bridge.ingest(key,digest);check();return result}}}
   const result=await session.rpc.rpc('character_production_qa_ready_slots',{p_limit:1})
   signal.throwIfAborted()
   if(result.error||!Array.isArray(result.data)||result.data.length>1)throw Error('QA queue unconfirmed')
   if(!enabled())throw Error('QA disabled during selection')
   selected=result.data.length===1
   return selected?'qa':null
  },
  stages:{async qa(callSignal){
   signal.throwIfAborted();callSignal.throwIfAborted()
   if(callSignal!==signal||!enabled()||!selected||used)throw Error('QA stage unavailable')
   used=true
   // Re-read current queue and exact materialization checks: revocation or
   // another worker's completion can change eligibility after selection.
   const result=await runner.run(signal)
   if(signal.aborted||result.status!=='checked'||result.held!==0)throw Error('QA held; reconcile original work')
  }},
  async whenSettled(){await session?.whenSettled()},
 }
}

