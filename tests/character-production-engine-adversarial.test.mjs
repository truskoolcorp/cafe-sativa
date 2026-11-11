import {test} from 'node:test';import assert from 'node:assert/strict';import {createCharacterProductionEngine} from '../lib/content/character-production-engine.ts';
const now=Date.now(),s={key:'slot',characterId:'synthetic',script:'Synthetic only',canonicalRevision:'a'.repeat(64),voiceId:'voice',portraitSha256:'b'.repeat(64),providerBindingRevision:'c'.repeat(64),provider:'test',model:'test',durationSeconds:5,authorizationId:'auth',authorizationExpiresAt:now+10000,period:'2026-11',quoteCents:40,periodCapCents:50};const c={enabled:true,provider:'test',model:'test',characters:['synthetic'],maxVideoBytes:1024,now:()=>now};
for(const [k,v] of [['key',null],['key',{}],['characterId','other'],['script',' '],['script',8],['canonicalRevision','bad'],['voiceId',{}],['providerBindingRevision',null],['provider','other'],['model','other'],['durationSeconds',0],['durationSeconds',181],['authorizationExpiresAt',now],['authorizationId',''],['period',{}],['quoteCents',0],['quoteCents',NaN],['periodCapCents',39]])test('invalid '+k+' '+String(v)+' blocks before opening',async()=>{const e=createCharacterProductionEngine(c,()=>{throw Error('opened')});assert.equal((await e.produce({...s,[k]:v})).status,'blocked')});
test('nonboolean enablement stays disabled',async()=>{const e=createCharacterProductionEngine({...c,enabled:'true'},()=>{throw Error('opened')});assert.equal((await e.produce(s)).status,'disabled')});
test('ambiguous or foreign queue rejected before provider reads',async()=>{for(const rows of [null,[{key:'slot'}],Array(6).fill({}),[{key:'slot',token:'token',taskId:'task',digest:'a'.repeat(64),providerBindingRevision:'b'.repeat(64),provider:'foreign',model:'test'}]]){const e=createCharacterProductionEngine(c,()=>({provider:{name:'test',collect(){throw Error('must not read')}},store:{pending:async()=>rows}}));const r=await e.collect();assert.equal(r.checked,0);assert.equal(r.status,'held')}});
test('invalid collection count cannot call dependencies',async()=>{const e=createCharacterProductionEngine(c,()=>{throw Error('opened')});for(const n of [0,6,1.5,'1'])await assert.rejects(e.collect(n))});
test('durable claim identity is snapshotted before final asynchronous validation',async()=>{
 for(const commit of [true,false]){
  let claim,checks=0;const submitted=[],unknown=[];
  const e=createCharacterProductionEngine(c,()=>({
   provider:{name:'test',submit:async()=>({taskId:'task'})},
   validateCurrent:async()=>{if(++checks===2){claim.token='mutated-token';claim.digest='f'.repeat(64)}return true},
   store:{claim:async(_slot,digest)=>(claim={token:'original-token',digest}),markSubmitted:async(_key,token)=>{submitted.push(token);return commit},markUnknown:async(_key,token)=>{unknown.push(token)}},
  }));
  assert.equal((await e.produce(s)).status,commit?'submitted':'held');
  assert.deepEqual(submitted,['original-token']);assert.deepEqual(unknown,commit?[]:['original-token']);
 }
});
