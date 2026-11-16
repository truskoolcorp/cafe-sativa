import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {assertEnrollmentRuntimeConsistency} from '../lib/content/character-production-enrollment-consistency.ts'
import {imageApprovedAvatar} from '../lib/content/character-production-canonical-image.ts'
import {heyGenBindingRevision} from '../lib/content/character-production-provider-heygen.ts'
const hash=s=>createHash('sha256').update(s).digest('hex')
function fixture(){
 const image={characterId:'zaria',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64),imageBytes:100,mime:'image/png',audio:{characterId:'zaria',canonicalRevision:'a'.repeat(64),portraitSha256:'b'.repeat(64),avatarId:'image-zaria',voiceId:'canonical',voiceModel:'eleven_v4',scriptSha256:hash('hello'),audioSha256:'c'.repeat(64),audioBytes:100,mime:'audio/mpeg',provider:'elevenlabs',synthesisReceiptId:'synthetic-receipt'}}
 const heygen={linkId:'reviewed-account',model:'avatar_iv',aspectRatio:'16:9',bindings:[imageApprovedAvatar(image)]}
 const slot={characterId:'zaria',canonicalRevision:image.canonicalRevision,portraitSha256:image.portraitSha256,voiceId:'canonical',script:'hello',provider:'heygen',model:'avatar_iv',quoteCents:35,durationSeconds:8,providerBindingRevision:heyGenBindingRevision(heygen,imageApprovedAvatar(image))}
 return {e:{manifest:{expectedUsername:'reviewed',heygen:{...heygen},candidates:[{slot,theme:'gallery'}],images:[{image:structuredClone(image),themes:['gallery'],quoteCents:35,durationSeconds:8}]}},w:{expectedHeyGenUsername:'reviewed',configuration:{heygen,engine:{provider:'heygen',model:'avatar_iv',characters:['zaria']}},images:[image]}}
}
test('exact finite planner/worker consistency needs no clients or authority',()=>{const {e,w}=fixture();assert.doesNotThrow(()=>assertEnrollmentRuntimeConsistency(e,w))})
for(const [label,edit] of Object.entries({account:({w})=>w.expectedHeyGenUsername='other',format:({w})=>w.configuration.heygen.aspectRatio='9:16',character:({w})=>w.configuration.engine.characters=[],missingImage:({w})=>w.images=[],duplicateImage:({w})=>w.images.push(structuredClone(w.images[0])),script:({e})=>e.manifest.candidates[0].slot.script='other',plannerAudio:({e})=>e.manifest.images[0].image.audio.audioSha256='d'.repeat(64),scene:({e})=>e.manifest.images[0].image.approvedScene={imageSha256:'d'.repeat(64),approvalReference:'synthetic'},theme:({e})=>e.manifest.images[0].themes=['other'],quote:({e})=>e.manifest.images[0].quoteCents=36,duration:({e})=>e.manifest.images[0].durationSeconds=9,avatar:({w})=>w.configuration.heygen.bindings[0].avatarId='other',duplicateProvider:({w})=>w.configuration.heygen.bindings.push({...w.configuration.heygen.bindings[0]}),duplicatePlanner:({e})=>e.manifest.images.push(structuredClone(e.manifest.images[0]))}))test(label+' mismatch refused offline',()=>{const f=fixture();edit(f);assert.throws(()=>assertEnrollmentRuntimeConsistency(f.e,f.w))})
test('unrelated valid character bindings remain allowed',()=>{const {e,w}=fixture();const other=structuredClone(w.images[0]);other.characterId='other';other.audio.characterId='other';other.audio.avatarId='other-avatar';w.images.push(other);w.configuration.heygen.bindings.push(imageApprovedAvatar(other));assert.doesNotThrow(()=>assertEnrollmentRuntimeConsistency(e,w))})
test('same-character competing provider binding rejected despite one exact match',()=>{const {e,w}=fixture();w.configuration.heygen.bindings.unshift({...w.configuration.heygen.bindings[0],avatarId:'other'});assert.throws(()=>assertEnrollmentRuntimeConsistency(e,w))})
test('factory snapshots and validates before phase construction or opening',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../lib/content/character-production-enrollment-server.ts',import.meta.url),'utf8')
 const check=source.indexOf('assertEnrollmentRuntimeConsistency(reviewed,workerManifest)')
 assert.ok(check>source.indexOf('const workerManifest=snapshotProductionManifest(manifest)'))
 for(const marker of ['planner:createInternalScopedPlannerEntry','worker:createInternalCharacterWorker','qa:createEnrolledQaEntry','openInternalProduction(workerManifest'])assert.ok(source.indexOf(marker)>check,marker)
 assert.match(source,/import \{assertEnrollmentRuntimeConsistency\} from '\.\/character-production-enrollment-consistency'/)
})
