import {test} from 'node:test';import assert from 'node:assert/strict';
import {createOccurrencePlanner,occurrenceKey} from '../lib/content/character-production-occurrence.ts';
import {productionSlotDigest} from '../lib/content/character-production-engine.ts';
const now=Date.parse('2026-11-11T12:00:00Z');
function row(scheduleId='weekly',scheduledAt=now){const slot={key:occurrenceKey(scheduleId,scheduledAt),characterId:'synthetic',script:'Test',canonicalRevision:'a'.repeat(64),voiceId:'voice',portraitSha256:'b'.repeat(64),providerBindingRevision:'c'.repeat(64),provider:'heygen',model:'model',durationSeconds:5,authorizationId:'auth',authorizationExpiresAt:scheduledAt+60000,period:'2026-11',quoteCents:1,periodCapCents:10};return {scheduleId,scheduleRevision:'d'.repeat(64),scheduledAt,latestStartAt:scheduledAt+60000,slot,slotDigest:productionSlotDigest(slot)}}
const plan=(at=now,limit=5)=>createOccurrencePlanner({enabled:true,maxPerTick:limit,now:()=>at});
test('disabled avoids clock and input access',()=>{assert.deepEqual(createOccurrencePlanner({enabled:false,maxPerTick:5,now:()=>{throw Error()}})(null),{status:'disabled',due:[]})});
test('due is inclusive, window end exclusive, future and stale skipped',()=>{assert.equal(plan()( [row()] ).due.length,1);assert.equal(plan(now+60000)([row()]).due.length,0);assert.equal(plan(now-1)([row()]).due.length,0)});
test('stable identity unaffected by schedule revision',()=>{const a=row(),b={...a,scheduleRevision:'e'.repeat(64)};assert.equal(plan()([a]).due[0].slot.key,plan()([b]).due[0].slot.key);assert.throws(()=>plan()([a,b]))});
test('whole page validated even beyond output limit',()=>{const a=row('a'),b=row('b');b.slotDigest='e'.repeat(64);assert.throws(()=>plan(now,1)([a,b]))});
test('window may not cross budget month or authorization expiry',()=>{const a=row();a.latestStartAt=a.slot.authorizationExpiresAt+1;assert.throws(()=>plan()([a]));const b=row('x',Date.parse('2026-11-30T23:59:40Z'));assert.throws(()=>plan()([b]))});
test('bounded earliest first immutable snapshots',()=>{const a=row('a',now-2),b=row('b',now-1),out=plan(now,1)([b,a]);a.slot.script='Changed';assert.equal(out.due.length,1);assert.equal(out.due[0].slot.script,'Test');assert.equal(out.due[0].scheduleId,'a');assert.ok(Object.isFrozen(out.due[0].slot))});
test('clock and bounds validated',()=>{assert.throws(()=>plan(NaN)([]));assert.throws(()=>plan(now,6));assert.throws(()=>plan()(Array(101).fill(row())))});
test('scheduled instant and slot key cannot diverge',()=>{const a=row();a.scheduledAt++;assert.throws(()=>plan()([a]))});
