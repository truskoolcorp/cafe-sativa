import test from 'node:test'
import assert from 'node:assert/strict'
import {snapshotProductionManifest} from '../lib/content/character-production-manifest-snapshot.ts'
test('caller mutation after composition cannot alter reviewed worker inputs; clock retained',()=>{
 const now=()=>42
 const source={expectedHeyGenUsername:'reviewed',images:[{audio:{sha:'audio'},approvedScene:{sha:'scene'}}],exactScope:{key:'owned',digest:'digest'},configuration:{engine:{now,characters:['zaria'],enabled:true},heygen:{bindings:[{voiceId:'voice',nested:{id:'bound'}}],mediaOrigins:['https://reviewed.example'],phases:{submitMs:8000}}}}
 const copy=snapshotProductionManifest(source)
 source.expectedHeyGenUsername='foreign';source.images[0].audio.sha='other';source.images[0].approvedScene.sha='other';source.exactScope.key='foreign'
 source.configuration.engine.characters.push('foreign');source.configuration.engine.enabled=false;source.configuration.engine.now=()=>99
 source.configuration.heygen.bindings[0].voiceId='foreign';source.configuration.heygen.bindings[0].nested.id='foreign';source.configuration.heygen.mediaOrigins.push('https://foreign.example');source.configuration.heygen.phases.submitMs=1
 assert.equal(copy.expectedHeyGenUsername,'reviewed');assert.equal(copy.images[0].audio.sha,'audio');assert.equal(copy.images[0].approvedScene.sha,'scene');assert.equal(copy.exactScope.key,'owned')
 assert.deepEqual(copy.configuration.engine.characters,['zaria']);assert.equal(copy.configuration.engine.enabled,true);assert.equal(copy.configuration.engine.now,now);assert.equal(copy.configuration.engine.now(),42)
 assert.deepEqual(copy.configuration.heygen,{bindings:[{voiceId:'voice',nested:{id:'bound'}}],mediaOrigins:['https://reviewed.example'],phases:{submitMs:8000}})
})
