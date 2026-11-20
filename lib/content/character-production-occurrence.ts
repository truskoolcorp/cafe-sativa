import {createHash} from 'node:crypto'
import type {ProductionSlot} from './character-production-engine.ts'
import {productionSlotDigest} from './character-production-engine.ts'
export type EnrolledOccurrence=Readonly<{scheduleId:string;scheduleRevision:string;scheduledAt:number;latestStartAt:number;slot:ProductionSlot;slotDigest:string}>
export type PlannerConfig={enabled:boolean;maxPerTick:number;now():number}
const id=/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/,hash=/^[a-f0-9]{64}$/
/** Input must exclude already-claimed/terminal occurrences before this bounded
 * selection, otherwise consumed oldest rows can starve later work. UTC instants must already be enrolled by an authorized scheduler. This module
 * does not interpret local time/DST, approve budgets, call providers or publish. */
export function occurrenceKey(scheduleId:string,scheduledAt:number){
 if(typeof scheduleId!=='string'||!id.test(scheduleId)||!Number.isSafeInteger(scheduledAt)||scheduledAt<0)throw Error('Invalid occurrence identity')
 return 'occurrence:'+createHash('sha256').update(JSON.stringify([scheduleId,scheduledAt])).digest('hex')
}
export function createOccurrencePlanner(configuration:PlannerConfig){
 const c=Object.freeze({...configuration})
 if(!Number.isSafeInteger(c.maxPerTick)||c.maxPerTick<1||c.maxPerTick>5)throw Error('Invalid tick bound')
 return (input:readonly EnrolledOccurrence[])=>{
  if(c.enabled!==true)return {status:'disabled' as const,due:[] as readonly EnrolledOccurrence[]}
  const now=c.now();if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid clock')
  if(!Array.isArray(input)||input.length>100)throw Error('Invalid enrollment page')
  const seen=new Set<string>()
  // Validate the entire bounded page before returning any work. No silent truncation
  // of malformed duplicates or future rows. Schedule revisions never reset identity.
  const snapshot=input.map(e=>{
   if(!e||typeof e.scheduleId!=='string'||!id.test(e.scheduleId)||typeof e.scheduleRevision!=='string'||!hash.test(e.scheduleRevision)||!Number.isSafeInteger(e.scheduledAt)||e.scheduledAt<0||!Number.isSafeInteger(e.latestStartAt)||e.latestStartAt<=e.scheduledAt||!e.slot||typeof e.slotDigest!=='string'||!hash.test(e.slotDigest)||Object.values(e.slot).some(v=>typeof v!=='string'&&typeof v!=='number'))throw Error('Invalid enrollment')
   const slot=Object.freeze({...e.slot}),key=occurrenceKey(e.scheduleId,e.scheduledAt)
   if(seen.has(key)||slot.key!==key||productionSlotDigest(slot)!==e.slotDigest||!Number.isSafeInteger(slot.authorizationExpiresAt)||slot.authorizationExpiresAt<e.latestStartAt||new Date(e.scheduledAt).toISOString().slice(0,7)!==slot.period||new Date(e.latestStartAt-1).toISOString().slice(0,7)!==slot.period)throw Error('Enrollment binding mismatch')
   seen.add(key);return Object.freeze({...e,slot})
  })
  const due=snapshot.filter(e=>e.scheduledAt<=now&&now<e.latestStartAt).sort((a,b)=>a.scheduledAt-b.scheduledAt||a.slot.key.localeCompare(b.slot.key)).slice(0,c.maxPerTick)
  return {status:'planned' as const,due:Object.freeze(due)}
 }
}
