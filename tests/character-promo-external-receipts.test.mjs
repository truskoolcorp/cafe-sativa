import {test} from 'node:test'
import assert from 'node:assert/strict'
import {externalPromoDeliveryDecision as decide} from '../lib/content/character-promo-external-receipts.ts'
const identity={promoId:'promo',videoSha256:'a'.repeat(64),brandId:'cafe',network:'facebook',accountId:'page'}
const receipt={...identity,provider:'metricool',providerId:'123',scheduledAt:'2026-11-14T16:00:00Z',observedAt:'2026-11-14T15:00:00Z',state:'scheduled'}
test('scheduled, published and unknown all suppress exact bytes/destination without claiming publication',()=>{for(const state of ['scheduled','published','unknown'])assert.equal(decide(identity,[{...receipt,state}]),'already_external')})
test('copied promo IDs and rescheduling never evade suppression',()=>assert.equal(decide({...identity,promoId:'copy'},[receipt]),'already_external'))
test('distinct account, brand, network or bytes are not rewritten or suppressed',()=>{for(const [key,value] of [['accountId','truskool'],['brandId','other'],['network','threads'],['videoSha256','b'.repeat(64)]])assert.equal(decide({...identity,[key]:value},[receipt]),'clear')})
test('missing or corrupted registry and identities fail closed',()=>{for(const receipts of [null,undefined,{},[{...receipt,providerId:''}],[{...receipt,state:'failed'}],[{...receipt,videoSha256:'bad'}]])assert.equal(decide(identity,receipts),'held');assert.equal(decide({...identity,accountId:''},[]),'held')})
test('empty authoritative registry is clear; suppression has no time expiry',()=>{assert.equal(decide(identity,[]),'clear');assert.equal(decide(identity,[{...receipt,scheduledAt:'2000-01-01T00:00:00Z'}]),'already_external')})
import {assertNoKnownExternalPromo} from '../lib/content/character-promo-known-external.ts'
test('verified Café Laviche delivery blocks copied media and preserves other destinations',()=>{const x={promoId:'copy',videoSha256:'ed8153e2ddd80b3099823eec24c22327cccad3eabdc4c0a039d4425b5f3a52e7',brandId:'7605217',network:'facebook',accountId:'105363501666032'};assert.throws(()=>assertNoKnownExternalPromo(x));assert.throws(()=>assertNoKnownExternalPromo({...x,network:'instagram',accountId:'cafesativainc'}));assert.doesNotThrow(()=>assertNoKnownExternalPromo({...x,brandId:'5373515',accountId:'146219355471397'}))})
import {readFileSync} from 'node:fs'
test('runtime blocks known receipt during readCurrent before durable claim as well as external write',()=>{const s=readFileSync(new URL('../lib/content/character-promo-dispatch-runtime.ts',import.meta.url),'utf8');assert.match(s,/readCurrent:async planId=>\{[\s\S]*?assertNoKnownExternalPromo\(current.approval.snapshot\)[\s\S]*?return current/);assert.match(s,/preflightExternalWrite:async\(\)=>\{assertNoKnownExternalPromo\(snapshot\)/)})
