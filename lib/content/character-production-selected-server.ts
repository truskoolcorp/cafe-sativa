import 'server-only'
import {createSelectedProductionSession} from './character-production-selected-session'
import {createRecurringCollectionSession} from './character-production-recurring-collect-server'
import {createRecurringGenerationSession} from './character-production-recurring-generate-server'
import {createRecurringQaSession} from './character-production-recurring-qa-server'
import type {InternalProductionManifest} from './character-production-server-composition'
import type {ProductionTimeBudget} from './character-production-time-budget'
import type {ProductionRpc} from './character-production-store'
import type {CafeRecurringSession,CafeRecurringPhase} from './character-production-recurring-entry'

/** Factory only. The caller must provide a separately approved, narrowly scoped
 * selector connection and current enrollment/manifest, never HTTP candidates.
 * No new backend credential fallback, runtime grants, route or cron exists here. */
export function createSelectedRecurringSession(d:{
 signal:AbortSignal;budget:ProductionTimeBudget;manifest:InternalProductionManifest;
 selectorRpc:ProductionRpc;enrollmentId:string;manifestSha256:string;
 now:()=>number;enabled:()=>boolean;whenSelectorSettled:()=>Promise<void>;
}):CafeRecurringSession {
 let adapter:CafeRecurringSession|undefined,phase:CafeRecurringPhase|undefined,selected=false
 const selection=createSelectedProductionSession({rpc:d.selectorRpc,signal:d.signal,enrollmentId:d.enrollmentId,manifestSha256:d.manifestSha256,now:d.now,enabled:d.enabled,
  async whenTransportsSettled(){await adapter?.whenSettled();await d.whenSelectorSettled()},
 })
 const check=(signal:AbortSignal)=>{d.signal.throwIfAborted();signal.throwIfAborted();if(signal!==d.signal||!d.enabled())throw Error('Selected stage unavailable')}
 const run=async(expected:CafeRecurringPhase,signal:AbortSignal)=>{
  check(signal);if(!selected||!phase||phase!==expected||!adapter)throw Error('No exact stage selected')
  const outcome=await selection.execute(async item=>{
   check(signal);if(item.phase!==phase)throw Error('Phase changed')
   const action=adapter!.stages[phase!];if(!action)throw Error('Unsupported selected phase')
   await action(signal)
   // Finish occurs inside this finite stage, after original transport settlement,
   // not in outer admission cleanup (which can run after response cancellation).
   await adapter!.whenSettled();check(signal);return 'settled'
  })
  if(outcome==='held')throw Error('Selected stage remains held')
 }
 return {
  async next(signal){
   check(signal);if(selected)throw Error('Selection consumed')
   const item=await selection.selectOnce();if(!item)return null
   phase=item.phase;selected=true
   adapter=phase==='collect'?createRecurringCollectionSession(signal,d.manifest,selection):phase==='generate'?createRecurringGenerationSession(signal,d.manifest,d.budget,selection):createRecurringQaSession(signal,selection)
   const actual=await adapter.next(signal);check(signal)
   if(actual!==phase)throw Error('Selected phase no longer eligible')
   return phase
  },
  stages:{collect:s=>run('collect',s),qa:s=>run('qa',s),generate:s=>run('generate',s)},
  async whenSettled(){await selection.whenSettled()},
 }
}
