import 'server-only'
import {createSelectedBindingReader} from './character-production-binding-snapshot'
import {imageApprovedAvatar} from './character-production-canonical-image'
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
 // Preserve reviewed account, allowlist and limits. Per-occurrence media is
 // obtained only from the selected durable snapshot, never a static fallback.
 const base={...d.manifest,exactScope:d.manifest.exactScope?{...d.manifest.exactScope}:undefined,images:[...d.manifest.images],configuration:{engine:{...d.manifest.configuration.engine,characters:[...d.manifest.configuration.engine.characters]},heygen:{...d.manifest.configuration.heygen,bindings:[...d.manifest.configuration.heygen.bindings],mediaOrigins:[...d.manifest.configuration.heygen.mediaOrigins],phases:d.manifest.configuration.heygen.phases?{...d.manifest.configuration.heygen.phases}:undefined}}}
 const bindings=createSelectedBindingReader({rpc:d.selectorRpc,signal:d.signal,enabled:d.enabled})
 let snapshotSha256:string|undefined
 let adapter:CafeRecurringSession|undefined,phase:CafeRecurringPhase|undefined,selected=false
 const selection=createSelectedProductionSession({rpc:d.selectorRpc,signal:d.signal,enrollmentId:d.enrollmentId,manifestSha256:d.manifestSha256,now:d.now,enabled:d.enabled,
  async whenTransportsSettled(){await adapter?.whenSettled();await d.whenSelectorSettled()},
 })
 const check=(signal:AbortSignal)=>{d.signal.throwIfAborted();signal.throwIfAborted();if(signal!==d.signal||!d.enabled())throw Error('Selected stage unavailable')}
 const run=async(expected:CafeRecurringPhase,signal:AbortSignal)=>{
  check(signal);if(!selected||!phase||phase!==expected||!adapter)throw Error('No exact stage selected')
  const outcome=await selection.execute(async item=>{
   check(signal);if(item.phase!==phase)throw Error('Phase changed')
   if(phase!=='qa'){const current=await bindings.read(item);check(signal);if(current.snapshotSha256!==snapshotSha256)throw Error('Original binding changed')}
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
   let manifest=base
   if(phase!=='qa'){
    if(base.images.length||base.configuration.heygen.bindings.length)throw Error('Static occurrence bindings prohibited')
    const original=await bindings.read(item);check(signal)
    const {snapshot,slot}=original,a=snapshot.account,h=base.configuration.heygen
    if(a.linkId!==h.linkId||a.model!==h.model||a.aspectRatio!==h.aspectRatio||a.expectedUsername!==base.expectedHeyGenUsername||!base.configuration.engine.characters.includes(slot.characterId)||base.configuration.engine.provider!==slot.provider||base.configuration.engine.model!==slot.model)throw Error('Snapshot outside reviewed configuration')
    if(base.exactScope&&(base.exactScope.key!==item.key||base.exactScope.digest!==item.digest))throw Error('Snapshot outside exact scope')
    snapshotSha256=original.snapshotSha256
    manifest={...base,images:[snapshot.image],configuration:{engine:{...base.configuration.engine,characters:[slot.characterId]},heygen:{...h,bindings:[imageApprovedAvatar(snapshot.image)]}}}
   }
   adapter=phase==='collect'?createRecurringCollectionSession(signal,manifest,selection):phase==='generate'?createRecurringGenerationSession(signal,manifest,d.budget,selection):createRecurringQaSession(signal,selection)
   const actual=await adapter.next(signal);check(signal)
   if(actual!==phase)throw Error('Selected phase no longer eligible')
   return phase
  },
  stages:{collect:s=>run('collect',s),qa:s=>run('qa',s),generate:s=>run('generate',s)},
  async whenSettled(){await selection.whenSettled()},
 }
}
