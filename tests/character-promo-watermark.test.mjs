import test from 'node:test'
import assert from 'node:assert/strict'
import {watermarkReadiness,KNOWN_THIRD_PARTY_MARKED_SHA256} from '../lib/content/character-promo-watermark.ts'
const id='draft',sha='1'.repeat(64),q={promo_id:id,video_sha256:sha,check_name:'third_party_watermark',result:'pass',evidence:'Reviewed complete clip; only approved Café Sativa identity mark.',reviewer_id:'11111111-1111-4111-8111-111111111111',created_at:new Date().toISOString()}
test('unknown, failed, sampled-without-pass and foreign hashes never imply clean',()=>{for(const rows of [[],[{...q,result:'needs_review'}],[{...q,result:'fail'}],[{...q,video_sha256:'2'.repeat(64)}],[q,q],[{...q,reviewer_id:null}],[{...q,evidence:''}]])assert.equal(watermarkReadiness(id,sha,rows).ready,false)})
test('known marked bytes cannot pass even with old mistaken approval',()=>{for(const hash of KNOWN_THIRD_PARTY_MARKED_SHA256)assert.equal(watermarkReadiness(id,hash,[{...q,video_sha256:hash}]).reason,'known_third_party_watermark')})
test('trusted reviewer exact-byte pass permits ecosystem marks, not automatic approval',()=>{assert.equal(watermarkReadiness(id,sha,[q]).ready,true);assert.equal(watermarkReadiness(id,'invalid',[q]).ready,false)})
