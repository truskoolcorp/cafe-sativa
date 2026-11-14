import test from 'node:test'
import assert from 'node:assert/strict'
import {canaryAuthorization as a,canaryWindowOpen,reviewedCanaryManifest} from '../lib/content/character-production-canary-manifest.ts'
import {canonicalImageDigest,imageApprovedAvatar} from '../lib/content/character-production-canonical-image.ts'
import {heyGenBindingRevision} from '../lib/content/character-production-provider-heygen.ts'
import {productionSlotDigest} from '../lib/content/character-production-engine.ts'
import {renderedAudioDigest} from '../lib/content/character-production-rendered-audio.ts'
test('one reviewed canary has an exact finite UTC window and no recurrence',()=>{
 assert.equal(new Date(a.startsAt).toISOString(),'2026-11-14T17:35:00.000Z')
 assert.equal(new Date(a.expiresAt).toISOString(),'2026-11-14T18:25:00.000Z')
 for(const n of [NaN,Infinity,a.startsAt-1,a.expiresAt,a.expiresAt+1])assert.equal(canaryWindowOpen(n),false)
 assert.equal(canaryWindowOpen(a.startsAt),true);assert.equal(canaryWindowOpen(a.expiresAt-1),true)
 assert.equal(a.quoteCents,35);assert.equal(a.periodCapCents,40);assert.equal(a.digest,'01931ca6d67b17badbf9c89ee8841ebdba11d73f0390f90ed95c842da887a6f3')
})
test('exact existing image and audio bind live identity without replacing portrait',()=>{
 const m=reviewedCanaryManifest(),p=m.images[0],b=m.configuration.heygen.bindings[0]
 assert.equal(m.images.length,1);assert.equal(m.configuration.heygen.bindings.length,1)
 assert.deepEqual(m.configuration.engine.characters,['zaria-solenne']);assert.equal(m.configuration.engine.now,Date.now)
 assert.equal(m.configuration.heygen.model,'avatar_iv');assert.equal(m.configuration.heygen.aspectRatio,'16:9')
 assert.deepEqual(m.configuration.heygen.mediaOrigins,['https://files2.heygen.ai'])
 assert.equal(p.portraitSha256,'ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca')
 assert.equal(p.approvedScene.imageSha256,'dc56e882a2beffac334927ecfe33b908568cbf2bc49065b0336259fca8fc784e')
 assert.equal(p.approvedScene.approvalReference,'Sentinel_674253e2c98c8191bdfe85de68dbb52d')
 assert.equal(p.audio.synthesisReceiptId,'uzGDp5HCorQQwo982hSH');assert.equal(p.audio.voiceId,'5zneNR4v1Uw5AjIZ9Un4')
 assert.equal(p.audio.voiceModel,'eleven_v4');assert.equal(p.audio.audioBytes,146318);assert.equal(p.imageBytes,2311086)
 assert.equal(renderedAudioDigest(p.audio),b.audioBindingSha256);assert.equal(canonicalImageDigest(p),b.imageBindingSha256)
 assert.deepEqual(imageApprovedAvatar(p),b)
 assert.equal(heyGenBindingRevision(m.configuration.heygen,b),'a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0')
})

test('pinned code scope matches the exact reviewed SQL slot digest',()=>{
 const slot={
  "key": "zaria-gallery-image-canary-20261114",
  "characterId": "zaria-solenne",
  "script": "Welcome to the Gallery at Café Sativa. I'm Zaria Solenne. Every piece has a story, and I'd love to help you discover yours.",
  "canonicalRevision": "3898db375b4742743369587dd716c8e2210a46e417e68213aab0f243a8991bf8",
  "voiceId": "5zneNR4v1Uw5AjIZ9Un4",
  "portraitSha256": "ce1ea17c890419d4c7a8384e5f32ac5997694b6598fdfe53d32ecac3003b9eca",
  "providerBindingRevision": "a5013652af3f70014c27e401aa4865a55161e62664a0447aa6aa858663a991c0",
  "provider": "heygen",
  "model": "avatar_iv",
  "durationSeconds": 9,
  "authorizationId": "keith-one-existing-credit-canary-40c-20261114",
  "authorizationExpiresAt": 1794680700000,
  "period": "2026-11",
  "quoteCents": 35,
  "periodCapCents": 40
}
 assert.equal(productionSlotDigest(slot),a.digest)
 assert.equal(slot.authorizationExpiresAt,a.expiresAt)
 assert.equal(slot.quoteCents,a.quoteCents);assert.equal(slot.periodCapCents,a.periodCapCents)
 assert.deepEqual(reviewedCanaryManifest().exactScope,{key:slot.key,digest:a.digest})
})
