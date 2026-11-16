import 'server-only'
import {productionSlotDigest,type ProductionSlot,type Pending} from './character-production-engine.ts'
import type {ProductionRpc} from './character-production-store.ts'
import type {ScheduledProductionSlot} from './character-production-coordinator.ts'
export type SelectedPhase='collect'|'qa'|'generate'
export type SelectedItem={enrollmentId:string;manifestSha256:string;ordinal:number;phase:SelectedPhase;key:string;digest:string;selectionToken:string;observedAt:number;payload:Pending|ScheduledProductionSlot|{key:string;digest:string}}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/.test(x)
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x)
const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)
const stable=(x:unknown):string=>JSON.stringify(x,(_k,v)=>object(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x))
/** Dormant exact-item capability. No route, grants, credentials or legacy queue
 * fallback. SQL still owns fairness and fencing. A lost next/finish response is
 * NEVER retried; any uncertainty leaves the original token in flight. Existing
 * engines must retain their authorization, paid-claim and receipt validations. */
export function createSelectedProductionSession(d:{rpc:ProductionRpc;signal:AbortSignal;enrollmentId:string;manifestSha256:string;now:()=>number;enabled:()=>boolean;whenTransportsSettled:()=>Promise<void>}){
 if(!uuid(d.enrollmentId)||!hash(d.manifestSha256))throw Error('Invalid trusted enrollment')
 let consumed=false,used=false,selected:SelectedItem|undefined,closed=false,poisoned=false,sealed=false,closingRequested=false
 let activeRun:Promise<unknown>|undefined
 const pending=new Set<Promise<unknown>>()
 const check=()=>{d.signal.throwIfAborted();if(closed||poisoned||closingRequested||!d.enabled())throw Error('Selection unavailable')}
 async function call(name:string,args:Record<string,unknown>){
  check();const promise=Promise.resolve().then(()=>{check();return d.rpc.rpc(name,args)});pending.add(promise)
  try{const r=await promise;check();if(r.error)throw Error('Selection receipt unavailable');return r.data}catch(e){poisoned=true;throw e}finally{pending.delete(promise)}
 }
 function validate(x:unknown,start:number,end:number):SelectedItem{
  if(!object(x)||x.enrollmentId!==d.enrollmentId||x.manifestSha256!==d.manifestSha256||!integer(x.ordinal)||x.ordinal<0||x.ordinal>31||!['collect','qa','generate'].includes(String(x.phase))||!uuid(x.selectionToken)||!id(x.key)||!hash(x.digest)||!integer(start)||!integer(end)||end<start||!integer(x.observedAt)||x.observedAt<start||x.observedAt>end||!object(x.payload))throw Error('Invalid selected identity')
  const p=x.payload
  if(x.phase==='generate'){
   if(!object(p.slot)||p.slot.key!==x.key||p.digest!==x.digest||productionSlotDigest(p.slot as ProductionSlot)!==x.digest||!integer(p.scheduledAt)||!integer(p.notAfter)||p.scheduledAt<0||p.notAfter<=p.scheduledAt||p.notAfter!==p.slot.authorizationExpiresAt)throw Error('Invalid selected due row')
  }else{
   if(p.key!==x.key||p.digest!==x.digest)throw Error('Invalid selected payload')
   if(x.phase==='collect'&&(![p.token,p.taskId,p.provider,p.model].every(id)||!hash(p.providerBindingRevision)))throw Error('Invalid original task')
  }
  return copy(x) as unknown as SelectedItem
 }
 async function readExact(){
  check();if(sealed)throw Error('Selection reads closed');if(!selected)throw Error('No selected item')
  const start=d.now(),data=await call('character_production_recurring_selected',{p_enrollment:d.enrollmentId,p_token:selected.selectionToken})
  try{const row=validate(data,start,d.now());if(stable({...row,observedAt:0})!==stable({...selected,observedAt:0}))throw Error('Selected item changed');return row}catch(e){poisoned=true;throw e}
 }
 async function drain(){
  sealed=true
  const results=await Promise.allSettled([Promise.resolve().then(()=>d.whenTransportsSettled()),...pending])
  if(results.some(r=>r.status==='rejected'))throw Error('Original transports unsettled')
 }
 return {
  async selectOnce(){
   check();if(sealed)throw Error('Selection reads closed');if(consumed)throw Error('Selection already consumed');consumed=true
   const start=d.now(),data=await call('character_production_recurring_next',{p_enrollment:d.enrollmentId})
   if(data===null)return null
   try{selected=validate(data,start,d.now());return copy(selected)}catch(e){poisoned=true;throw e}
  },
  /** Read bridge returns ONLY original selected payload, not a new queue head. */
  async readCollect(){const r=await readExact();if(r.phase!=='collect')throw Error('Wrong phase');return [r.payload as Pending]},
  async readDue(){const r=await readExact();if(r.phase!=='generate')throw Error('Wrong phase');return [r.payload as ScheduledProductionSlot]},
  async readQa(){const r=await readExact();if(r.phase!=='qa')throw Error('Wrong phase');return r.payload as {key:string;digest:string}},
  async execute(run:(item:SelectedItem)=>Promise<'settled'|'held'>){
   check();if(sealed||used||!selected)throw Error('Execution already consumed or absent');used=true
   try{
    const row=await readExact();check();activeRun=Promise.resolve().then(()=>{check();return run(row)})
    const outcome=await activeRun
    if(outcome!=='settled'&&outcome!=='held')throw Error('Uncertain stage')
    // Callback must join all work it starts. Backend settlement joins original
    // timed-out transports; a rejection/abort prohibits bookkeeping completion.
    await drain();check()
    const result=await call('character_production_recurring_finish',{p_enrollment:d.enrollmentId,p_token:selected.selectionToken,p_outcome:outcome})
    if(!['ready','done','held'].includes(String(result)))throw Error('Finish unconfirmed')
    closed=true;return result as 'ready'|'done'|'held'
   }catch(e){poisoned=true;throw e}
  },
  async whenSettled(){closingRequested=true;sealed=true;await Promise.allSettled(activeRun?[activeRun]:[]);await drain()},
 }
}
