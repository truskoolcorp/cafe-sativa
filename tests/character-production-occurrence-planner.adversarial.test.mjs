import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOccurrencePlanner,occurrenceKey} from '../lib/content/character-production-occurrence.ts';
import {productionSlotDigest} from '../lib/content/character-production-engine.ts';
const now=Date.parse('2026-11-11T12:00:00Z');
function enrolled(){
 const slot={key:occurrenceKey('schedule',now),characterId:'synthetic',script:'Synthetic',canonicalRevision:'a'.repeat(64),voiceId:'voice',portraitSha256:'b'.repeat(64),providerBindingRevision:'c'.repeat(64),provider:'heygen',model:'model',durationSeconds:5,authorizationId:'auth',authorizationExpiresAt:now+1000,period:'2026-11',quoteCents:1,periodCapCents:10};
 return {scheduleId:'schedule',scheduleRevision:'d'.repeat(64),scheduledAt:now,latestStartAt:now+1000,slot,slotDigest:productionSlotDigest(slot)};
}
const plan=createOccurrencePlanner({enabled:true,maxPerTick:5,now:()=>now});
const coercible=value=>({toString:()=>value,toJSON:()=>value});
test('occurrence identity refuses coercible schedule IDs',()=>{
 assert.throws(()=>occurrenceKey(coercible('schedule'),now));
});
test('enrollment metadata must be immutable primitive strings',()=>{
 for(const field of ['scheduleId','scheduleRevision','slotDigest']){
  const e=enrolled();e[field]=coercible(e[field]);assert.throws(()=>plan([e]),field);
 }
});
test('slot snapshot rejects nested mutable values even with matching initial digest',()=>{
 for(const field of ['voiceId','canonicalRevision','script','characterId','authorizationId']){
  const e=enrolled();e.slot[field]=coercible(e.slot[field]);
  assert.equal(productionSlotDigest(e.slot),e.slotDigest,'fixture has same initial digest');
  assert.throws(()=>plan([e]),field);
 }
});
test('exact UTC month boundary is allowed only as excluded window end',()=>{
 const e=enrolled();e.scheduledAt=Date.parse('2026-11-30T23:59:59Z');e.latestStartAt=Date.parse('2026-12-01T00:00:00Z');
 e.slot={...e.slot,key:occurrenceKey(e.scheduleId,e.scheduledAt),authorizationExpiresAt:e.latestStartAt};e.slotDigest=productionSlotDigest(e.slot);
 assert.equal(createOccurrencePlanner({enabled:true,maxPerTick:1,now:()=>e.scheduledAt})([e]).due.length,1);
 assert.equal(createOccurrencePlanner({enabled:true,maxPerTick:1,now:()=>e.latestStartAt})([e]).due.length,0);
});
