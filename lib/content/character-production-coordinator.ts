import {productionSlotDigest} from './character-production-engine.ts'
import type {ProductionSlot,createCharacterProductionEngine} from './character-production-engine.ts'
import type {ProductionRpc} from './character-production-store.ts'

type Engine=ReturnType<typeof createCharacterProductionEngine>
export type ScheduledProductionSlot=Readonly<{slot:ProductionSlot;digest:string;scheduledAt:number;notAfter:number}>
export type ProductionQueue={due(provider:string,model:string,limit:number):Promise<ScheduledProductionSlot[]>}
export type CoordinatorConfig=Readonly<{enabled:boolean;provider:string;model:string;maxSubmissions:number;collectLimit:number;scanLimit:number;maxTickMs:number;now():number}>
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/.test(v)
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
function valid(row:ScheduledProductionSlot,c:Pick<CoordinatorConfig,'provider'|'model'>){
 const s=row?.slot
 return !!s&&id(s.key)&&s.provider===c.provider&&s.model===c.model&&hash(row.digest)&&productionSlotDigest(s)===row.digest&&
  integer(row.scheduledAt)&&row.scheduledAt>=0&&integer(row.notAfter)&&row.notAfter>row.scheduledAt&&
  integer(s.authorizationExpiresAt)&&row.notAfter===s.authorizationExpiresAt
}
/** Read-only adapter for the separately reviewed SQL proposal. No owner writes,
 * inferred schedules, grants, credentials or clock supplied to the database. */
export function createProductionQueue(rpc:ProductionRpc,now:()=>number):ProductionQueue {
 return {async due(provider,model,limit){
  if(!id(provider)||!id(model)||!integer(limit)||limit<1||limit>25)throw Error('Invalid queue query')
  const start=now(),result=await rpc.rpc('character_production_due',{p_provider:provider,p_model:model,p_limit:limit}),end=now()
  if(result.error||!object(result.data)||!integer(result.data.observedAt)||result.data.observedAt<start||result.data.observedAt>end||end<start||!Array.isArray(result.data.rows)||result.data.rows.length>limit)throw Error('Queue observation unavailable or stale')
  const rows=result.data.rows as ScheduledProductionSlot[]
  if(rows.some(row=>!valid(row,{provider,model})))throw Error('Invalid authorized queue record')
  return rows.map(row=>Object.freeze({...row,slot:Object.freeze({...row.slot})}))
 }}
}
/** Dormant orchestration only. Callers must explicitly wire a bounded cron route,
 * live canonical checks/provider transport and the durable production store.
 * It never creates a new slot, approves QA, publishes, or retries a provider write.
 * Recurrence means separately pre-authorized exact slots, not cloning old scripts. */
export function createCharacterProductionCoordinator(config:CoordinatorConfig,open:()=>{engine:Engine;queue:ProductionQueue}){
 const c=Object.freeze({...config});let running=false
 return {async tick(){
  const summary={checked:0,pendingQa:0,submitted:0,blocked:0,skipped:0,held:0}
  if(c.enabled!==true)return {status:'disabled' as const,...summary}
  if(!id(c.provider)||!id(c.model)||!integer(c.maxSubmissions)||c.maxSubmissions<1||c.maxSubmissions>5||!integer(c.collectLimit)||c.collectLimit<1||c.collectLimit>5||!integer(c.scanLimit)||c.scanLimit<1||c.scanLimit>25||!integer(c.maxTickMs)||c.maxTickMs<1||c.maxTickMs>300000)throw Error('Invalid coordinator bounds')
  if(running)return {status:'busy' as const,...summary}
  running=true
  try{
   const started=c.now(),deadline=started+c.maxTickMs
   if(!integer(started)||!integer(deadline))throw Error('Invalid clock')
   let last=started
   const current=()=>{const n=c.now();if(!integer(n)||n<last)throw Error('Clock moved backward');last=n;return n}
   const {engine,queue}=open()
   // Existing provider task IDs are collected first; uncertain collection blocks new cost.
   const collected=await engine.collect(c.collectLimit)
   summary.checked=collected.checked;summary.pendingQa=collected.pendingQa;summary.held=collected.held
   if(collected.status!=='collected'||collected.held)return {status:'held' as const,...summary}
   if(current()>=deadline)return {status:'bounded' as const,...summary}
   const rows=await queue.due(c.provider,c.model,c.scanLimit)
   if(!Array.isArray(rows)||rows.length>c.scanLimit)throw Error('Invalid queue size')
   const keys=new Set<string>()
   if(rows.some(row=>{if(!valid(row,c)||keys.has(row.slot.key))return true;keys.add(row.slot.key);return false}))throw Error('Invalid or ambiguous queue')
   const ordered=rows.map(row=>({...row,slot:Object.freeze({...row.slot})})).sort((a,b)=>a.scheduledAt-b.scheduledAt||(a.slot.key<b.slot.key?-1:a.slot.key>b.slot.key?1:0))
   let attempts=0
   for(const row of ordered){
    const now=current()
    if(now>=deadline)return {status:'bounded' as const,...summary}
    if(now<row.scheduledAt||now>=row.notAfter||row.slot.period!==new Date(now).toISOString().slice(0,7)){summary.skipped++;continue}
    if(attempts>=c.maxSubmissions)return {status:'bounded' as const,...summary}
    attempts++
    // Engine rechecks live authorization/canon and atomically reserves this exact
    // unique key. Concurrent workers cannot reclaim an existing or unknown job.
    const result=await engine.produce(row.slot)
    if(result.status==='submitted')summary.submitted++
    else if(result.status==='blocked')summary.blocked++
    else {summary.held++;return {status:'held' as const,...summary}}
   }
   return {status:'complete' as const,...summary}
  }catch{return {status:'held' as const,...summary,held:summary.held+1}}
  finally{running=false}
 }}
}
