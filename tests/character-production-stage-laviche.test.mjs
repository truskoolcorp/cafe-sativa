import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {stageLavicheScope,stageLavicheSpeech} from '../lib/content/character-production-stage-laviche-policy.ts'
import {includedOperationQuota,validateIncludedSpeechOperation,runIncludedSpeechOperation} from '../lib/content/character-production-included-speech-operation.ts'

const revision='a'.repeat(64)
const scope=stageLavicheScope(revision)
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('Laviche can only be bound to the one fixed approved private take',()=>{
 assert.equal(stageLavicheScope(undefined),null)
 assert.equal(stageLavicheScope('invented'),null)
 assert.equal(Object.isFrozen(scope),true)
 assert.equal(scope.scriptSha256,createHash('sha256').update(scope.script).digest('hex'))
 assert.equal(scope.maxDurationSeconds<22,true)
 validateIncludedSpeechOperation(scope)
 for (const patch of [
  {key:'stage-ahnika-laviche-intro-v2'},{voiceId:'generic'},{portraitSha256:'b'.repeat(64)},
  {script:'changed',scriptSha256:createHash('sha256').update('changed').digest('hex')},
  {modelId:'eleven_v3'},{expiresAt:scope.expiresAt+1},{authorizationRef:'different'},{maxDurationSeconds:22},
 ]) assert.throws(()=>validateIncludedSpeechOperation({...scope,...patch}),/operation_unverified/)
})

test('included-only quota rejects overage or an unverified canonical voice rate',()=>{
 const subscription={character_count:200,character_limit:10600,status:'active',can_extend_character_limit:false,allowed_to_extend_character_limit:false,max_credit_limit_extension:0}
 const models=[{model_id:scope.modelId,can_do_text_to_speech:true,maximum_text_length_per_request:250,model_rates:{character_cost_multiplier:1,cost_discount_multiplier:1}}]
 const voice={voice_id:scope.voiceId,sharing:{rate:1}}
 assert.equal(includedOperationQuota(scope,subscription,models,voice).overageEntitled,false)
 assert.throws(()=>includedOperationQuota(scope,{...subscription,can_extend_character_limit:true},models,voice),/included_only_unverified/)
 assert.throws(()=>includedOperationQuota(scope,subscription,models,{...voice,sharing:null}),/canonical_rate_unverified/)
})

test('an existing or ambiguous claim stops the provider call',async()=>{
 let calls=0
 await assert.rejects(()=>runIncludedSpeechOperation(scope,{
  now:()=>stageLavicheSpeech.expiresAt-10000,signal:new AbortController().signal,monotonic:()=>1,
  canon:async()=>{},quota:async()=>({overageEntitled:false}),
  store:{preflight:async()=>{},claim:async()=>{throw Error('insert_unconfirmed')}},
  synthesize:async()=>{calls++;throw Error('unexpected')},measureDuration:async()=>20,
 }),/insert_unconfirmed/)
 assert.equal(calls,0)
})

test('dedicated flag, private admin readback and no stage or publishing writes',()=>{
 const server=source('lib/content/character-production-stage-laviche-server.ts')
 const shared=source('lib/content/character-production-included-speech-server.ts')
 assert.match(server,/stageLavicheScope\(process.env.CS_STAGE_LAVICHE_SPEECH_CANON_REVISION\)/)
 assert.match(server,/authorize:isContentAdmin/g)
 assert.match(server,/enabled:\(\)=>false/)
 assert.match(server,/synthesisAttempted:false/)
 assert.match(shared,/stage[\s\S]*?CS_STAGE_LAVICHE_SPEECH_ENABLED==='true'[\s\S]*?CS_CHARACTER_FINITE_SPEECH_ENABLED==='true'/)
 assert.doesNotMatch(server,/publicUrl|createSignedUrl|publish|METRICOOL/)
 assert.match(source('app/api/admin/character-promotions/stage-laviche-intro/route.ts'),/POST=renderStageLavicheSpeech/)
 assert.doesNotMatch(source('app/api/admin/character-promotions/stage-laviche-intro/audio/route.ts'),/POST/)
})
