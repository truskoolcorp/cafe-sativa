import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCharacterAudioRuntime} from '../lib/content/character-production-audio-runtime.ts'
test('default audio runtime opens no dependencies for produce or collect',async()=>{
 let opened=0;const r=createCharacterAudioRuntime(null,()=>{opened++;throw Error('must not open')})
 assert.equal((await r.produce({})).status,'disabled');assert.equal((await r.collect()).status,'disabled');assert.equal(opened,0)
})
test('audio runtime rejects mismatched activation, provider, model and byte caps before opening',()=>{
 const engine={enabled:true,provider:'heygen',model:'avatar_v',maxVideoBytes:1024,characters:['synthetic'],now:Date.now}
 const heygen={enabled:true,linkId:'synthetic',model:'avatar_v',maxVideoBytes:1024,clips:[],mediaOrigins:[],timeoutMs:100}
 for(const patch of [{enabled:false},{model:'avatar_iv'},{maxVideoBytes:2048}])assert.throws(()=>createCharacterAudioRuntime({engine,heygen:{...heygen,...patch}},()=>{throw Error('must not open')}),/configuration mismatch/)
 assert.throws(()=>createCharacterAudioRuntime({engine:{...engine,provider:'other'},heygen}),/configuration mismatch/)
})

import {createHash} from 'node:crypto'
import {heyGenAudioBindingRevision} from '../lib/content/character-production-provider-heygen-audio.ts'
import {productionSlotDigest} from '../lib/content/character-production-engine.ts'
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const avatar={characterId:'synthetic',avatarId:'approved-avatar',voiceId:'canonical-elevenlabs-voice',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64)};
const script='Exact speech.\nIncluding whitespace.';
const audio={sourceProvider:'elevenlabs',sourceModel:'synthetic-explicit-model',sourceSettingsSha256:'0'.repeat(64),sourceReceiptId:'source-receipt',sourceReceiptRevision:'1'.repeat(64),transferReceiptId:'transfer-receipt',transferReceiptRevision:'2'.repeat(64),characterId:avatar.characterId,canonicalRevision:avatar.canonicalRevision,portraitSha256:avatar.portraitSha256,voiceId:avatar.voiceId,scriptSha256:hash(script),audioSha256:'c'.repeat(64),audioBytes:10000,durationMs:10501,heyGenLinkId:'approved-account',audioAssetId:'approved-audio-asset',slotKey:'audio-slot-1',authorizationId:'approved-video-generation',authorizationExpiresAt:Date.now()+60000,period:'2026-11',quoteCents:50,periodCapCents:100};
const clip={avatar,audio},config={enabled:true,linkId:audio.heyGenLinkId,model:'avatar_v',clips:[clip],mediaOrigins:['https://files2.heygen.ai'],timeoutMs:2000,maxVideoBytes:1024};
const slot={key:audio.slotKey,characterId:avatar.characterId,script,canonicalRevision:avatar.canonicalRevision,portraitSha256:avatar.portraitSha256,voiceId:avatar.voiceId,providerBindingRevision:heyGenAudioBindingRevision(config,clip),provider:'heygen',model:config.model,durationSeconds:11,authorizationId:audio.authorizationId,authorizationExpiresAt:audio.authorizationExpiresAt,period:audio.period,quoteCents:audio.quoteCents,periodCapCents:audio.periodCapCents};

function runtimeFixture({revoked=false,afterClaim=false,ambiguous=false,revokeDuringVerification=false}={}){
 let claims=0,writes=0,held=0,claimed=false,revokedAuthority=false;
 const rpc={async rpc(name,args){
  if(name.endsWith('_authorization'))return {error:null,data:{slot,digest:productionSlotDigest(slot),revision:'authority-v1',enabled:!revokedAuthority&&!(afterClaim&&claimed),observedAt:Date.now()}};
  if(name.endsWith('_claim')){if(claimed)return {data:null,error:null};claimed=true;claims++;return {data:{token:'claim-token',digest:args.p_digest},error:null}};
  if(name.endsWith('_submitted'))return {data:true,error:null};
  if(name.endsWith('_unknown')){held++;return {data:true,error:null}};
  throw Error('Unexpected RPC '+name)
 }};
 const engine={enabled:true,provider:'heygen',model:config.model,maxVideoBytes:config.maxVideoBytes,characters:[avatar.characterId],now:Date.now};
 const runtime=createCharacterAudioRuntime({engine,heygen:config},()=>({rpc,storage:{},
  transport:{async create_video_from_avatar(args){writes++;assert.equal(args.audioAssetId,audio.audioAssetId);assert.equal(args.voiceId,undefined);if(ambiguous)throw Error('unknown outcome');return {taskId:'task-1'}},async get_video(){throw Error('not expected')}},
  codecs:{receipt:r=>r,status:r=>r},verifier:{async validateCurrent(){if(revokeDuringVerification)revokedAuthority=true;return !revoked}},
  async readCanon(){return {verifiedAt:new Date().toISOString()}},normalizeCanon(){return {live:true,production_ready:true,rights_status:'approved',voice_status:'canonical',character_id:avatar.characterId,revision_sha256:avatar.canonicalRevision,portrait_sha256:avatar.portraitSha256,voice_id:avatar.voiceId}}
 }));
 return {runtime,counts:()=>({claims,writes,held})}
}
test('composed runtime validates exact canonical audio before claim and never resubmits duplicate',async()=>{
 const x=runtimeFixture();assert.equal((await x.runtime.produce(slot)).status,'submitted');assert.equal((await x.runtime.produce(slot)).status,'held');assert.deepEqual(x.counts(),{claims:1,writes:1,held:0});
})
test('composed runtime holds revocation after claim and unknown write without retry',async()=>{
 const revoked=runtimeFixture({revoked:true});assert.equal((await revoked.runtime.produce(slot)).status,'blocked');assert.deepEqual(revoked.counts(),{claims:0,writes:0,held:0});
 const late=runtimeFixture({afterClaim:true});assert.equal((await late.runtime.produce(slot)).status,'held');assert.deepEqual(late.counts(),{claims:1,writes:0,held:1});
 const unknown=runtimeFixture({ambiguous:true});assert.equal((await unknown.runtime.produce(slot)).status,'held');assert.equal((await unknown.runtime.produce(slot)).status,'held');assert.deepEqual(unknown.counts(),{claims:1,writes:1,held:1});
})

test('independent authority is rechecked after asynchronous provenance verification',async()=>{const x=runtimeFixture({revokeDuringVerification:true});assert.equal((await x.runtime.produce(slot)).status,'blocked');assert.deepEqual(x.counts(),{claims:0,writes:0,held:0})})
